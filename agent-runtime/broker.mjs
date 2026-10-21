/** Trusted host broker. No model process receives a host credential or writable host mount. */
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, rm, stat, statfs, chmod } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { resolve, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { createPublicProxy, providerEventTap } from './network.mjs'
import { ProviderFiles } from './provider-files.mjs'
import { McpProxy } from './mcp-proxy.mjs'

const root=resolve(process.env.PREP_DATA_DIR||'/var/lib/aiq-prep')
const secret=process.env.PREP_WORKER_SECRET||''
const core=(process.env.PREP_CORE_URL||'http://127.0.0.1:3332/api/prep/internal').replace(/\/$/,'')
const gateway=process.env.PREP_BRIDGE_IP||'172.30.223.1'
const image=process.env.PREP_IMAGE||'aiq-prep:1'
const network=process.env.PREP_NETWORK||'aiq-prep'
const maxFile=25*1024*1024, maxArchive=128*1024*1024
const maxJobs=Number(process.env.PREP_CONCURRENCY||1)
const maxModelCalls=Number(process.env.PREP_MAX_MODEL_CALLS||100)
if(!Number.isInteger(maxModelCalls)||maxModelCalls<1||maxModelCalls>500)throw new Error('PREP_MAX_MODEL_CALLS必须是1到500的整数')
const terminal=new Set(['completed','failed','cancelled'])
const jobs=new Map(), ips=new Map()
let mcpConfig={servers:[]}
if(process.env.PREP_MCP_CONFIG){try{mcpConfig=JSON.parse(await readFile(resolve(process.env.PREP_MCP_CONFIG),'utf8'))}catch{throw new Error('MCP配置文件无法读取或格式不正确')}}
const mcpProxy=new McpProxy(mcpConfig)
function providerHeaders(headers={}){
  const allowed=new Set(['files-api-2025-04-14','mid-conversation-tool-changes-2026-07-01'])
  const beta=String(headers['anthropic-beta']||'').split(',').map(s=>s.trim()).filter(v=>allowed.has(v)).join(',')
  return {'content-type':headers['content-type']||'application/json','anthropic-version':headers['anthropic-version']||'2023-06-01',...(beta?{'anthropic-beta':beta}:{}),'x-api-key':process.env.DEEPSEEK_API_KEY||'',authorization:`Bearer ${process.env.DEEPSEEK_API_KEY||''}`}
}
const providerFiles=new ProviderFiles(join(root,'sessions'),async(method,path,bytes,headers)=>{
  if(!process.env.DEEPSEEK_API_KEY)throw new Error('尚未配置 DeepSeek 官方 API Key')
  const response=await fetch('https://api.deepseek.com/anthropic'+path,{method,headers:providerHeaders(headers),body:bytes?.length?bytes:undefined,signal:AbortSignal.timeout(60000)})
  const data=await response.text();if(data.length>1024*1024)throw new Error('模型附件响应过大')
  let value;try{value=JSON.parse(data)}catch{value={error:{message:'模型附件接口返回格式不正确'}}}
  return {status:response.status,body:value}
})
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(v)
const safeName=v=>String(v).replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,180)||'file'
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)}
const redact=text=>[secret,process.env.DEEPSEEK_API_KEY,...[...jobs.values()].map(j=>j.token)].filter(Boolean).reduce((s,key)=>s.replaceAll(key,'[credential]'),String(text)).slice(0,2000)
const json=(res,status,value)=>{if(!res.headersSent)res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))}
async function body(req,limit=256*1024){let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;if(total>limit)throw new Error('请求过大');chunks.push(chunk)}return Buffer.concat(chunks)}
async function inputJson(req){return JSON.parse((await body(req)).toString('utf8')||'{}')}
async function atomic(path,value){const tmp=path+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,path)}
function snapshot(j){return {id:j.id,sessionId:j.sessionId,ownerId:j.ownerId,status:j.status,response:j.response,error:j.error,events:j.events,modelCalls:j.modelCalls||0}}
async function persist(j){j.writes=(j.writes||Promise.resolve()).catch(()=>{}).then(()=>atomic(join(root,'jobs',j.id+'.json'),snapshot(j)));return j.writes}
function emit(j,type,data){
  if(terminal.has(j.status))return
  if(j.events.length>=10000||j.eventBytes>8*1024**2){void cancel(j,'本次执行记录达到上限');return}
  const item={id:(j.events.at(-1)?.id||0)+1,type,data}
  // One verbose tool response must not consume unbounded database storage.
  if(Buffer.byteLength(JSON.stringify(item))>150000)item.data={message:JSON.stringify(data).slice(0,40000),truncated:true}
  j.events.push(item);j.eventBytes=(j.eventBytes||0)+Buffer.byteLength(JSON.stringify(item))
  if(!j.flushTimer)j.flushTimer=setTimeout(()=>{j.flushTimer=null;void persist(j)},300)
}
async function coreRequest(j,suffix,{method='GET',bytes,headers={}}={}){
  const r=await fetch(`${core}/runs/${j.id}${suffix}`,{method,headers:{authorization:`Bearer ${secret}`,...headers},body:bytes,signal:AbortSignal.timeout(suffix==='/image'?300000:120000)})
  if(!r.ok){let message='教学服务暂不可用';try{message=(await r.json()).error?.message||message}catch{}throw new Error(message)}
  return r
}
function docker(args,{stdin,maxBytes=4*1024*1024,timeout=120000,onLine}={}){
  return new Promise((done,fail)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out=[],count=0,err='',pending='',finished=false
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('容器命令超时'))},timeout)
    function finish(error,value){if(finished)return;finished=true;clearTimeout(timer);error?fail(error):done(value)}
    child.on('error',e=>finish(e));child.stderr.on('data',b=>{err=(err+b.toString()).slice(-4000)})
    const decoder=new StringDecoder('utf8')
    child.stdout.on('data',b=>{
      count+=b.length;if(count>maxBytes){child.kill('SIGKILL');finish(new Error('执行输出超过限制'));return}
      if(onLine){pending+=decoder.write(b);let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);onLine(line)}}else out.push(b)
    })
    child.on('close',code=>{if(onLine&&pending)onLine(pending);finish(code===0?null:new Error(`隔离环境执行失败：${redact(err||'exit '+code)}`),Buffer.concat(out))})
    child.stdin.on('error',()=>{});if(stdin?.pipe)stdin.pipe(child.stdin);else child.stdin.end(stdin)
  })
}
export function containerArgs(j,inputDir){
  return ['run','-d','--name',j.container,'--label','aiq.prep=1','--network',network,'--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--memory-swap','1g','--cpus','1.5','--read-only','--user','1000:1000','--tmpfs','/state:rw,nosuid,nodev,size=192m,uid=1000,gid=1000,mode=700','--tmpfs','/work:rw,nosuid,nodev,size=192m,uid=1000,gid=1000,mode=700','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777','--shm-size','64m','--mount',`type=bind,src=${inputDir},dst=/inputs,readonly`,'-e',`PREP_BROKER_URL=http://${gateway}:3330`,'-e',`PREP_RUN_ID=${j.id}`,'-e',`PREP_JOB_TOKEN=${j.token}`,'-e',`HTTP_PROXY=http://${gateway}:3333`,'-e',`HTTPS_PROXY=http://${gateway}:3333`,'-e',`http_proxy=http://${gateway}:3333`,'-e',`https_proxy=http://${gateway}:3333`,'-e',`NO_PROXY=${gateway}`,'-e',`no_proxy=${gateway}`,'--entrypoint','sleep',image,'infinity']
}
async function archive(j){
  const file=join(root,'sessions',j.sessionId+'.tgz'),temp=file+'.tmp'
  const child=spawn('docker',['exec',j.container,'tar','czf','-','-C','/','state','work'],{stdio:['ignore','pipe','pipe']})
  let bytes=0;child.stdout.on('data',b=>{bytes+=b.length;if(bytes>maxArchive)child.kill('SIGKILL')});child.stderr.resume()
  const ended=new Promise((ok,no)=>{child.on('error',no);child.on('close',code=>code===0&&bytes<=maxArchive?ok():no(new Error('对话状态超过保存限制')))})
  try{await Promise.all([pipeline(child.stdout,createWriteStream(temp,{mode:0o600})),ended]);await rename(temp,file);await atomic(join(root,'sessions',j.sessionId+'.json'),{ownerId:j.ownerId})}catch(error){child.kill('SIGKILL');await rm(temp,{force:true});throw error}
}
async function run(j,request){
  const inputs=join(root,'inputs',j.id);j.container='aiqprep-'+j.id.toLowerCase()
  try{
    const space=await statfs(root);if(space.bavail*space.bsize<8*1024**3)throw new Error('备课服务器可用空间不足')
    const names=await readdir(join(root,'sessions'));let bytes=0;for(const name of names.filter(n=>n.endsWith('.tgz')))bytes+=(await stat(join(root,'sessions',name))).size
    const journals=await readdir(join(root,'jobs'));for(const name of journals.filter(n=>n.endsWith('.json')))bytes+=(await stat(join(root,'jobs',name))).size
    if(bytes>2*1024**3)throw new Error('备课对话空间已满，请删除不用的对话')
    j.status='running';emit(j,'status',{status:'running',message:'正在准备隔离环境'})
    const source=await (await coreRequest(j,'/input')).json()
    await mkdir(inputs,{mode:0o755})
    await chmod(inputs,0o755)
    const files=[];let inputSize=0
    for(const f of source.files||[]){
      if(!validId(f.id)||f.size>maxFile||(inputSize+=f.size)>250*1024**2)throw new Error('当前对话附件超过运行环境限制')
      const response=await coreRequest(j,`/attachments/${f.id}`),data=Buffer.from(await response.arrayBuffer())
      if(data.length>maxFile||data.length!==f.size)throw new Error('附件大小校验失败')
      const name=safeName(f.name),path=join(inputs,f.id+'-'+name);await writeFile(path,data,{mode:0o444});await chmod(path,0o444);files.push({...f,name})
    }
    if(j.cancelled)return
    await docker(containerArgs(j,inputs))
    if(j.cancelled)return
    const inspection=JSON.parse((await docker(['inspect',j.container])).toString())[0]
    j.ip=inspection.NetworkSettings.Networks[network]?.IPAddress;if(!j.ip)throw new Error('隔离网络不可用');ips.set(j.ip,j)
    const saved=join(root,'sessions',j.sessionId+'.tgz')
    try{const meta=JSON.parse(await readFile(join(root,'sessions',j.sessionId+'.json'),'utf8'));if(meta.ownerId!==j.ownerId)throw new Error('会话归属不一致');await docker(['exec','-i',j.container,'tar','--no-same-owner','-xzf','-','-C','/'],{stdin:createReadStream(saved),timeout:60000})}catch(e){if(e.code!=='ENOENT')throw e}
    await docker(['exec','-i',j.container,'sh','-c','cat > /state/input.json'],{stdin:JSON.stringify({...request,files,skills:source.skills||[],history:source.history||[],mcpServers:mcpProxy.descriptors(j,`http://${gateway}:3330`)})})
    emit(j,'status',{status:'running',message:'正在加载智能体'})
    await docker(['exec',j.container,'node','/app/runner.mjs'],{timeout:request.timeoutMinutes*60000,maxBytes:12*1024**2,onLine(line){
      let v;try{v=JSON.parse(line)}catch{return}
      if(v.type==='done')j.response=typeof v.data?.response==='string'?v.data.response.slice(0,200000):''
      else if(v.type==='fatal')j.error ||=redact(v.data?.message||'模型执行失败')
      else if(['status','tool-start','tool-result','error'].includes(v.type))emit(j,v.type,v.data)
    }})
    if(j.cancelled)return
    await archive(j)
    if(j.error)throw new Error(j.error)
    j.status='completed';await persist(j)
  }catch(error){if(!j.cancelled){j.status='failed';j.error=redact(j.error||error.message);await persist(j)}}
  finally{
    mcpProxy.cancelJob(j)
    if(j.ip)ips.delete(j.ip)
    await docker(['rm','-f',j.container],{timeout:15000}).catch(()=>{})
    await mcpProxy.releaseJob(j)
    await rm(inputs,{recursive:true,force:true});j.cleaned=true
    if(j.cancelled){j.status='cancelled';await persist(j)}
  }
}
async function cancel(j,message){
  if(terminal.has(j.status))return
  j.cancelled=true;j.error ||=message
  mcpProxy.cancelJob(j)
  if(j.container)await docker(['rm','-f',j.container],{timeout:20000}).catch(()=>{})
  await j.running?.catch(()=>{});j.status='cancelled';await persist(j)
}
async function exportFile(j,path){
  if(typeof path!=='string'||path.length>500)throw new Error('文件路径不正确')
  // Resolve components through directory descriptors, never follow model-controlled symlinks.
  const program=`import os,sys,stat\np=sys.argv[1]; prefix='/work/output/'\nassert p.startswith(prefix)\nparts=p[len(prefix):].split('/')\nassert parts and all(x not in ('','.','..') for x in parts)\nfd=os.open('/work',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\nfd2=os.open('output',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=fd2\nfor part in parts[:-1]:\n n=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=n\nf=os.open(parts[-1],os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW,dir_fd=fd);os.close(fd)\ns=os.fstat(f);assert stat.S_ISREG(s.st_mode) and 0<s.st_size<=${maxFile}\nwith os.fdopen(f,'rb') as stream: sys.stdout.buffer.write(stream.read(${maxFile+1}))`
  const bytes=await docker(['exec',j.container,'python3','-c',program,path],{maxBytes:maxFile,timeout:30000})
  const name=safeName(path.replaceAll('\\','/').split('/').pop())
  return (await coreRequest(j,`/artifacts?filename=${encodeURIComponent(name)}`,{method:'POST',bytes,headers:{'content-type':'application/octet-stream'}})).json()
}
export function claimModelCall(j){
  j.modelCalls=(j.modelCalls||0)+1
  if(j.modelCalls<=maxModelCalls)return
  const message=`本次备课已达到模型调用上限（${maxModelCalls}次），请缩小任务或联系管理员调整PREP_MAX_MODEL_CALLS`
  if(!j.error){j.error=message;emit(j,'error',{message})}
  throw new Error(message)
}
async function model(j,req,res,path){
  if(path.startsWith('/v1/files')){
    if((j.fileCalls=(j.fileCalls||0)+1)>250)throw new Error('本次模型附件请求达到上限')
    const bytes=['POST'].includes(req.method)?await body(req,maxFile+1024*1024):undefined
    const result=await providerFiles.handle(j,req.method,path,bytes,req.headers);return json(res,result.status,result.body)
  }
  if(path!=='/v1/messages'||req.method!=='POST')return json(res,404,{error:'模型接口不存在'})
  claimModelCall(j)
  if(!process.env.DEEPSEEK_API_KEY)throw new Error('尚未配置 DeepSeek 官方 API Key')
  const bytes=await body(req,32*1024**2)
  if(path==='/v1/messages'){const parsed=JSON.parse(bytes);if(parsed.model!=='deepseek-flash'||!Number.isInteger(parsed.max_tokens)||parsed.max_tokens>16384)throw new Error('模型参数超出允许范围');await providerFiles.validateReferences(j,parsed.messages)}
  await new Promise((done,fail)=>{
    const upstream=https.request('https://api.deepseek.com/anthropic'+path,{method:'POST',headers:providerHeaders(req.headers),timeout:180000},remote=>{
      if(remote.statusCode>=400){remote.resume();json(res,502,{error:{type:'api_error',message:`DeepSeek 官方接口返回 ${remote.statusCode}，请检查模型权限、余额和配置`}});done();return}
      res.writeHead(remote.statusCode||200,{'content-type':remote.headers['content-type']||'application/json'})
      const tap=providerEventTap((type,data)=>emit(j,type,data)),decoder=new StringDecoder('utf8')
      remote.on('data',b=>{if((remote.headers['content-type']||'').includes('text/event-stream'))tap.push(decoder.write(b))})
      remote.on('end',()=>{tap.push(decoder.end());tap.flush();done()});remote.on('error',fail);remote.pipe(res)
    });upstream.on('error',fail);upstream.on('timeout',()=>upstream.destroy(new Error('模型响应超时')));res.on('close',()=>upstream.destroy());upstream.end(bytes)
  })
}
async function handler(req,res){
  try{
    const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean)
    const hostAuth=equal(req.headers.authorization,`Bearer ${secret}`)&&secret.length>=32
    if(url.pathname==='/health'&&hostAuth){
      let dockerReady=false;try{await docker(['image','inspect',image],{timeout:4000});dockerReady=true}catch{}
      return json(res,200,{ready:!!process.env.DEEPSEEK_API_KEY&&dockerReady,message:!process.env.DEEPSEEK_API_KEY?'尚未配置 DeepSeek 官方 API Key':!dockerReady?'备课镜像尚未就绪':''})
    }
    if(url.pathname==='/jobs'&&req.method==='POST'&&hostAuth){
      const b=await inputJson(req)
      if(![b.id,b.sessionId,b.ownerId].every(validId)||typeof b.content!=='string'||b.content.length>20000||!Number.isInteger(b.timeoutMinutes)||b.timeoutMinutes<1||b.timeoutMinutes>60)throw new Error('任务参数不正确')
      const old=jobs.get(b.id);if(old){if(old.ownerId&&(old.ownerId!==b.ownerId||old.sessionId!==b.sessionId))throw new Error('任务归属不一致');if(!old.ownerId){Object.assign(old,{ownerId:b.ownerId,sessionId:b.sessionId});await persist(old)}return json(res,200,{id:old.id,status:old.status})}
      if([...jobs.values()].filter(j=>!terminal.has(j.status)).length>=maxJobs)return json(res,429,{error:'运行器繁忙'})
      if([...jobs.values()].some(j=>j.sessionId===b.sessionId&&!terminal.has(j.status)))throw new Error('同一对话已有运行任务')
      const j={...b,token:randomBytes(32).toString('hex'),status:'queued',events:[],modelCalls:0};jobs.set(j.id,j);await persist(j)
      j.running=run(j,b);return json(res,202,{id:j.id,status:j.status})
    }
    if(parts[0]==='sessions'&&validId(parts[1])&&req.method==='DELETE'&&hostAuth){
      const b=await inputJson(req),related=[...jobs.values()].filter(j=>j.sessionId===parts[1])
      if(related.some(j=>j.ownerId!==b.ownerId||!terminal.has(j.status)))throw new Error('会话归属不一致或任务仍在运行')
      let meta;try{meta=JSON.parse(await readFile(join(root,'sessions',parts[1]+'.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
      if(meta&&meta.ownerId!==b.ownerId)throw new Error('会话归属不一致')
      await providerFiles.removeSession({sessionId:parts[1],ownerId:b.ownerId})
      for(const j of related){jobs.delete(j.id);clearTimeout(j.flushTimer);await j.writes;await rm(join(root,'jobs',j.id+'.json'),{force:true})}
      await rm(join(root,'sessions',parts[1]+'.json'),{force:true});await rm(join(root,'sessions',parts[1]+'.tgz'),{force:true});return json(res,200,{ok:true})
    }
    if(parts[0]!=='jobs'||!validId(parts[1]))return json(res,404,{error:'接口不存在'})
    let j=jobs.get(parts[1]);if(!j&&hostAuth&&parts[2]==='cancel'&&req.method==='POST'){
      j={id:parts[1],status:'cancelled',events:[]};jobs.set(j.id,j);await persist(j);return json(res,200,{ok:true})
    }
    if(!j)return json(res,404,{error:'任务不存在'})
    if(hostAuth){
      if(parts[2]==='events'&&req.method==='GET'){const after=Number(url.searchParams.get('after')||0),events=j.events.filter(e=>e.id>after);return json(res,200,{...snapshot(j),events:events.slice(0,200),hasMore:events.length>200})}
      if(parts[2]==='cancel'&&req.method==='POST'){await cancel(j);return json(res,200,{ok:true})}
    }
    if(!equal(req.headers.authorization,`Bearer ${j.token}`)&&!equal(req.headers['x-api-key'],j.token))return json(res,403,{error:'无效任务凭证'})
    if(terminal.has(j.status)||j.cancelled)return json(res,410,{error:'任务已结束'})
    if(parts[2]==='mcp'&&parts.length===4)return await mcpProxy.handle(j,parts[3],req,res)
    if(parts[2]==='model'&&parts[3]==='anthropic')return await model(j,req,res,'/'+parts.slice(4).join('/')+url.search)
    if(parts[2]==='tool'&&req.method==='POST'){
      const value=await inputJson(req);if(typeof value.callId!=='string'||value.callId.length>160)throw new Error('工具调用编号不正确')
      return json(res,200,await(await coreRequest(j,'/tool',{method:'POST',bytes:JSON.stringify(value),headers:{'content-type':'application/json'}})).json())
    }
    if(parts[2]==='proposals'&&validId(parts[3])&&req.method==='GET')return json(res,200,await(await coreRequest(j,'/proposals/'+parts[3])).json())
    if(parts[2]==='export'&&req.method==='POST')return json(res,200,await exportFile(j,(await inputJson(req)).path))
    if(parts[2]==='image'&&req.method==='POST'){
      if((j.imageCalls=(j.imageCalls||0)+1)>4)throw new Error('每次备课最多生成4张配图')
      const value=await inputJson(req),result=await(await coreRequest(j,'/image',{method:'POST',bytes:JSON.stringify(value),headers:{'content-type':'application/json'}})).json()
      const file=result.attachment,bytes=Buffer.from(await(await coreRequest(j,'/attachments/'+file.id)).arrayBuffer())
      if(bytes.length>maxFile)throw new Error('图片超过文件限制')
      const path='/work/output/illustration-'+file.id+'.png'
      await docker(['exec','-i',j.container,'python3','-c','import sys; open(sys.argv[1],"wb").write(sys.stdin.buffer.read())',path],{stdin:bytes})
      return json(res,200,{attachment:file,path})
    }
    return json(res,404,{error:'接口不存在'})
  }catch(error){if(!res.headersSent)json(res,400,{error:redact(error.message)});else res.destroy()}
}
export async function start(){
  if(secret.length<32)throw new Error('PREP_WORKER_SECRET must contain at least 32 characters')
  if(process.env.PREP_ADMIN_PATCH)throw new Error('PREP_ADMIN_PATCH已停用；请迁移为宿主PREP_MCP_CONFIG，避免将共享凭据挂入教师沙箱')
  await mkdir(root,{recursive:true,mode:0o700});for(const name of ['jobs','sessions','inputs'])await mkdir(join(root,name),{recursive:true,mode:0o700})
  // Inputs must be traversable by the unprivileged container; only individual fresh directories are mounted.
  for(const file of await readdir(join(root,'jobs'))){
    if(!/^[A-Za-z0-9_-]{1,40}\.json$/.test(file))continue
    const j=JSON.parse(await readFile(join(root,'jobs',file),'utf8'))
    if(!terminal.has(j.status)){j.status='failed';j.error='执行服务重启，本次任务已停止；可在原对话继续';await docker(['rm','-f','aiqprep-'+j.id.toLowerCase()],{timeout:15000}).catch(()=>{})}
    jobs.set(j.id,j);await persist(j)
  }
  const servers=[]
  for(const host of ['127.0.0.1',gateway]){const server=http.createServer(handler);server.requestTimeout=180000;await new Promise((ok,no)=>{server.once('error',no);server.listen(3330,host,ok)});servers.push(server)}
  const proxy=createPublicProxy({authorize:req=>{const ip=req.socket.remoteAddress?.replace('::ffff:','');const j=ips.get(ip);return j&&!j.cancelled&&!terminal.has(j.status)?j:false}})
  await new Promise((ok,no)=>{proxy.once('error',no);proxy.listen(3333,gateway,ok)});servers.push(proxy)
  let stopping=false
  async function stop(){if(stopping)return;stopping=true;for(const server of servers)server.close();await Promise.all([...jobs.values()].filter(j=>!terminal.has(j.status)).map(j=>cancel(j,'执行服务停止')));process.exit(0)}
  process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
  console.log('AIQ preparation broker ready')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await start()
