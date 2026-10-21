import http from 'node:http'
import net from 'node:net'
import { lookup } from 'node:dns/promises'

export function publicAddress(address){
  if(net.isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number)
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)
  }
  // Use IPv4 egress only; IPv6 translation/tunnelling must not bypass private-address checks.
  return false
}
export async function resolvePublic(hostname){
  const host=hostname.replace(/^\[|\]$/g,'')
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true,family:4})
  if(!addresses.length||addresses.some(v=>!publicAddress(v.address)))throw new Error('禁止访问本机、内网和元数据地址')
  return addresses[0]
}
export function createPublicProxy({authorize=()=>true}={}){
  function budget(req){
    const value=authorize(req)
    if(!value)throw new Error('代理认证失败')
    if(typeof value!=='object')return ()=>{}
    value.proxyRequests=(value.proxyRequests||0)+1
    if(value.proxyRequests>250)throw new Error('本次联网请求达到上限')
    return (bytes,close)=>{value.proxyBytes=(value.proxyBytes||0)+bytes;if(value.proxyBytes>128*1024*1024)close()}
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const count=budget(req)
      const url=new URL(req.url)
      if(url.protocol!=='http:'||url.username||url.password||url.port&&url.port!=='80')throw new Error('只允许公共HTTP/HTTPS网页')
      const address=await resolvePublic(url.hostname)
      const headers={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection']
      const upstream=http.request({hostname:address.address,family:address.family,port:80,path:url.pathname+url.search,method:req.method,headers,timeout:30000},remote=>{res.writeHead(remote.statusCode||502,remote.headers);remote.on('data',b=>count(b.length,()=>{remote.destroy();res.destroy()}));remote.pipe(res)})
      req.on('data',b=>count(b.length,()=>upstream.destroy()));res.on('close',()=>upstream.destroy())
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});upstream.on('timeout',()=>upstream.destroy());req.pipe(upstream)
    }catch(error){res.writeHead(403,{'content-type':'text/plain; charset=utf-8'});res.end(error.message)}
  })
  server.on('connect',async(req,socket,head)=>{
    try{
      const count=budget(req)
      const url=new URL('https://'+req.url)
      if(url.username||url.password||url.port&&url.port!=='443')throw new Error('仅允许HTTPS 443端口')
      const address=await resolvePublic(url.hostname)
      const upstream=net.connect({host:address.address,family:address.family,port:443},()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream)})
      upstream.on('data',b=>count(b.length,()=>{upstream.destroy();socket.destroy()}));socket.on('data',b=>count(b.length,()=>{upstream.destroy();socket.destroy()}))
      upstream.setTimeout(120000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy())
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')}
  })
  return server
}

/** Tap the real provider SSE; no model-written status text is treated as reasoning. */
export function providerEventTap(emit){
  let pending='',text='',reasoning='',last=Date.now()
  const flush=()=>{if(reasoning){emit('reasoning',{text:reasoning});reasoning=''}if(text){emit('text',{text});text=''}last=Date.now()}
  return {
    push(chunk){
      pending+=chunk.replace(/\r/g,'')
      if(pending.length>2*1024*1024)throw new Error('模型事件过大')
      let index
      while((index=pending.indexOf('\n\n'))>=0){
        const frame=pending.slice(0,index);pending=pending.slice(index+2)
        for(const line of frame.split('\n'))if(line.startsWith('data:')){
          try{
            const data=JSON.parse(line.slice(5).trim())
            if(data.type==='content_block_delta'&&data.delta?.type==='thinking_delta')reasoning+=data.delta.thinking||''
            if(data.type==='content_block_delta'&&data.delta?.type==='text_delta')text+=data.delta.text||''
            const delta=data.choices?.[0]?.delta
            if(delta?.reasoning_content)reasoning+=delta.reasoning_content
            if(delta?.content)text+=delta.content
          }catch{}
        }
      }
      if(text.length+reasoning.length>=800||Date.now()-last>300)flush()
    },flush,
  }
}
