import { randomBytes } from 'node:crypto'

const FILE_LIMIT=1024*1024
const BLOCKED_HEADERS=new Set(['host','connection','content-length','transfer-encoding','proxy-authorization','proxy-connection','te','trailer','upgrade','content-type','accept','mcp-session-id','mcp-protocol-version','last-event-id'])
class McpRequestError extends Error { constructor(status,message){super(message);this.status=status} }
const fail=(status,message)=>{throw new McpRequestError(status,message)}
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(value)

/** Trusted, administrator-only input. No destination or credential is model supplied. */
export function normalizeMcpConfig(value={servers:[]}){
  if(!value||typeof value!=='object'||!Array.isArray(value.servers)||value.servers.length>8)throw new Error('MCP配置必须含servers数组，最多8个服务')
  const names=new Set()
  return value.servers.map(server=>{
    if(!server||typeof server.name!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(server.name)||names.has(server.name))throw new Error('MCP服务名称不正确或重复')
    names.add(server.name)
    let url;try{url=new URL(server.url)}catch{throw new Error('MCP服务地址不正确')}
    if(url.username||url.password||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('MCP仅允许HTTPS远程地址或loopback HTTP；凭据必须放在headers')
    if(server.headers!==undefined&&(!server.headers||typeof server.headers!=='object'||Array.isArray(server.headers)))throw new Error('MCP headers必须是对象')
    const headers={}
    for(const [key,entry] of Object.entries(server.headers||{})){
      const name=key.toLowerCase()
      if(!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)||BLOCKED_HEADERS.has(name)||name.startsWith('mcp-')||typeof entry!=='string'||/[\r\n\0]/.test(entry)||entry.length>8192)throw new Error('MCP认证头配置不正确')
      headers[name]=entry
    }
    const privateValues=Object.values(headers).flatMap(entry=>[entry,entry.replace(/^(?:Bearer|Basic)\s+/i,'')]).filter(Boolean)
    for(const entry of url.searchParams.values())if(entry)privateValues.push(entry)
    const secrets=[...new Set(privateValues.flatMap(entry=>[entry,JSON.stringify(entry).slice(1,-1)]))].sort((a,b)=>b.length-a.length)
    return {name:server.name,url:url.href,headers,secrets}
  })
}

/** Per-job Streamable HTTP MCP bridge; credentials stay in this host process. */
export class McpProxy {
  constructor(config={servers:[]},{fetchImpl=globalThis.fetch,timeoutMs=120000,maxRequestBytes=FILE_LIMIT,maxResponseBytes=8*FILE_LIMIT,maxJobBytes=64*FILE_LIMIT,maxRequests=250}={}){
    this.servers=new Map(normalizeMcpConfig(config).map(server=>[server.name,server]));this.jobs=new Map()
    this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.maxRequestBytes=maxRequestBytes;this.maxResponseBytes=maxResponseBytes;this.maxJobBytes=maxJobBytes;this.maxRequests=maxRequests
  }
  descriptors(job,baseURL){
    if(!id(job.id))throw new Error('MCP任务编号不正确')
    return [...this.servers.keys()].map(name=>({name,url:`${baseURL.replace(/\/$/,'')}/jobs/${job.id}/mcp/${name}`}))
  }
  state(job){
    if(!id(job.id)||!id(job.ownerId)||!id(job.sessionId))fail(403,'MCP任务归属不正确')
    let state=this.jobs.get(job.id)
    if(!state){state={ownerId:job.ownerId,sessionId:job.sessionId,requests:0,bytes:0,servers:new Map(),controllers:new Set()};this.jobs.set(job.id,state)}
    if(state.ownerId!==job.ownerId||state.sessionId!==job.sessionId)fail(403,'MCP任务归属不正确')
    return state
  }
  redact(server,text){for(const secret of server.secrets)text=text.replaceAll(secret,'[credential]');return text}
  cancelJob(job){for(const controller of this.jobs.get(job.id)?.controllers||[])controller.abort()}
  async releaseJob(job){
    const state=this.jobs.get(job.id);if(!state)return
    this.cancelJob(job);this.jobs.delete(job.id)
    await Promise.allSettled([...state.servers].flatMap(([name,record])=>{
      const server=this.servers.get(name)
      return [...record.sessions.values()].map(async remoteId=>{
        const response=await this.fetch(server.url,{method:'DELETE',redirect:'error',headers:{...server.headers,'mcp-session-id':remoteId,'mcp-protocol-version':record.protocol||'2025-03-26'},signal:AbortSignal.timeout(5000)})
        await response.body?.cancel()
      })
    }))
  }
  async handle(job,name,request,response){
    let state,controller
    const disconnected=()=>controller?.abort()
    try{
      const server=this.servers.get(name);if(!server)fail(404,'MCP服务未配置')
      state=this.state(job)
      if(++state.requests>this.maxRequests)fail(429,'本次MCP请求达到上限')
      if(!['GET','POST','DELETE'].includes(request.method))fail(405,'MCP请求方法不支持')
      let record=state.servers.get(name)
      if(!record){record={sessions:new Map(),initialized:false,protocol:''};state.servers.set(name,record)}
      const localId=request.headers['mcp-session-id']
      if(localId!==undefined&&(typeof localId!=='string'||!record.sessions.has(localId)))fail(404,'MCP会话不存在或不属于本任务')
      const protocol=request.headers['mcp-protocol-version']
      if(protocol!==undefined&&(typeof protocol!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(protocol)))fail(400,'MCP协议版本不正确')
      if(protocol)record.protocol=protocol
      const headers={...server.headers,accept:request.method==='GET'?'text/event-stream':'application/json, text/event-stream'}
      // MCP 2026 peers check these metadata headers against the JSON-RPC body.
      // They are protocol metadata, never destinations or authentication.
      for(const [name,value] of Object.entries(request.headers))if(/^mcp-(?:method|name|param-[a-z0-9_-]+)$/.test(name)){
        if(typeof value!=='string'||value.length>8192||/[\r\n\0]/.test(value))fail(400,'MCP协议元数据不正确')
        headers[name]=value
      }
      if(localId)headers['mcp-session-id']=record.sessions.get(localId)
      if(protocol)headers['mcp-protocol-version']=protocol
      const lastEvent=request.headers['last-event-id']
      if(lastEvent!==undefined){if(typeof lastEvent!=='string'||lastEvent.length>256||/[\r\n\0]/.test(lastEvent))fail(400,'MCP事件游标不正确');headers['last-event-id']=lastEvent}
      let bytes,method
      if(request.method==='POST'){
        if(!String(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'MCP只接受JSON消息')
        const parts=[];let size=0
        for await(const chunk of request){size+=chunk.length;if(size>this.maxRequestBytes)fail(413,'MCP请求过大');parts.push(chunk)}
        bytes=Buffer.concat(parts);state.bytes+=bytes.length
        let message;try{message=JSON.parse(bytes)}catch{fail(400,'MCP消息不是有效JSON')}
        if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||message.method!==undefined&&typeof message.method!=='string')fail(400,'MCP消息格式不正确')
        method=message.method
        if(!localId&&!record.initialized&&!['initialize','server/discover'].includes(method))fail(400,'请先初始化MCP会话')
        // Never attach an older remote session to a fresh initialization.
        if(method==='initialize')delete headers['mcp-session-id']
        headers['content-type']='application/json'
      }else if(!record.initialized||request.method==='DELETE'&&!localId)fail(400,'MCP会话尚未初始化')
      if(state.bytes>this.maxJobBytes)fail(429,'本次MCP流量达到上限')
      controller=new AbortController();state.controllers.add(controller)
      request.once('aborted',disconnected);response.once('close',disconnected)
      const remote=await this.fetch(server.url,{method:request.method,headers,body:bytes,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(this.timeoutMs)])})
      const remoteSession=remote.headers.get('mcp-session-id')
      let exposedSession=localId
      if(remoteSession&&remote.ok){
        if(remoteSession.length>1024||/[\r\n\0]/.test(remoteSession))fail(502,'MCP服务返回了无效会话')
        if(!localId||record.sessions.get(localId)!==remoteSession){exposedSession='mcp-'+randomBytes(24).toString('hex');record.sessions.set(exposedSession,remoteSession)}
      }
      if(['initialize','server/discover'].includes(method)&&remote.ok)record.initialized=true
      if(request.method==='DELETE'&&remote.ok&&localId)record.sessions.delete(localId)
      if(remote.status===404&&localId)record.sessions.delete(localId)
      const contentType=remote.headers.get('content-type')||'application/json'
      if(remote.ok&&remote.status!==202&&remote.status!==204&&!/^(application\/json|text\/event-stream)(?:;|$)/i.test(contentType))fail(502,'MCP服务返回了不支持的内容类型')
      if(Number(remote.headers.get('content-length'))>this.maxResponseBytes)fail(502,'MCP响应过大')
      response.writeHead(remote.status,{'content-type':contentType,'cache-control':'no-store',...(exposedSession&&remote.status!==404?{'mcp-session-id':exposedSession}:{})})
      const decoder=new TextDecoder(),sse=/^text\/event-stream(?:;|$)/i.test(contentType)
      let pending='',received=0
      if(remote.body)for await(const chunk of remote.body){
        received+=chunk.length;state.bytes+=chunk.length
        if(received>this.maxResponseBytes||state.bytes>this.maxJobBytes)fail(502,'MCP响应或任务流量超过上限')
        pending+=decoder.decode(chunk,{stream:true})
        if(sse){let match;while((match=/\r?\n\r?\n/.exec(pending))){const end=match.index+match[0].length;response.write(this.redact(server,pending.slice(0,end)));pending=pending.slice(end)}}
      }
      pending+=decoder.decode();response.end(this.redact(server,pending))
    }catch(error){
      const aborted=controller?.signal.aborted
      controller?.abort()
      if(response.headersSent)response.destroy()
      else{const status=error instanceof McpRequestError?error.status:aborted?504:502;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:error instanceof McpRequestError?error.message:'MCP服务暂不可用或请求已停止'}))}
    }finally{
      request.removeListener('aborted',disconnected);response.removeListener('close',disconnected)
      if(state&&controller)state.controllers.delete(controller)
    }
  }
}
