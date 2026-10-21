import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpProxy,normalizeMcpConfig } from '../mcp-proxy.mjs'

const TOKEN='fixture-shared-MCP-secret-73de'
const jobs={a:{id:'job-a',ownerId:'teacher-a',sessionId:'lesson-a'},b:{id:'job-b',ownerId:'teacher-b',sessionId:'lesson-b'}}
const rpc=(method,id=1,params={})=>({jsonrpc:'2.0',id,method,params})
const listen=server=>new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>ok(`http://127.0.0.1:${server.address().port}`))})
const close=async server=>{server.closeAllConnections();await new Promise(ok=>server.close(ok))}
const json=(response,status,value,headers={})=>{response.writeHead(status,{'content-type':'application/json',...headers});response.end(JSON.stringify(value))}

async function fixture(handler,options={}){
  const calls=[],errors=[]
  const remote=http.createServer((request,response)=>{void(async()=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk)
    const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):undefined
    calls.push({method:request.method,url:request.url,headers:request.headers,body})
    await handler(request,response,body,calls)
  })().catch(error=>{errors.push(error);if(!response.headersSent)json(response,500,{error:'Fixture failed'});else response.destroy()})})
  const remoteURL=await listen(remote)
  const proxy=new McpProxy({servers:[{name:'offline',url:remoteURL+'/fixed?token='+TOKEN,headers:{Authorization:'Bearer '+TOKEN,'X-Administrator':'trusted-value'}}]},options)
  const gateway=http.createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname.split('/').filter(Boolean)[0]
    void proxy.handle(jobs[name]||jobs.a,'offline',request,response)
  })
  const url=await listen(gateway)
  const send=async({job='a',method='POST',body=rpc('initialize'),session,headers={}}={})=>fetch(url+'/'+job+'?url=https://attacker.invalid',{method,headers:{...(method==='POST'?{'content-type':'application/json'}:{}),...(session?{'mcp-session-id':session}:{}),...headers},body:method==='POST'?typeof body==='string'?body:JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)})
  return {proxy,calls,errors,send,url,remoteURL,async close(){await Promise.all([proxy.releaseJob(jobs.a),proxy.releaseJob(jobs.b)]);await close(gateway);await close(remote);assert.deepEqual(errors,[])}}
}

function normalServer(request,response,body){
  if(request.method==='GET')return json(response,405,{error:'GET unsupported'})
  if(request.method==='DELETE'){response.writeHead(204);response.end();return}
  if(body.method==='server/discover')return json(response,200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}})
  if(body.method==='initialize')return json(response,200,{jsonrpc:'2.0',id:body.id,result:{protocolVersion:body.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}},{'mcp-session-id':'remote-private-session'})
  if(body.method==='notifications/initialized'){response.writeHead(202);response.end();return}
  if(body.method==='tools/list')return json(response,200,{jsonrpc:'2.0',id:body.id,result:{resultType:'complete',ttlMs:0,cacheScope:'private',tools:[{name:'echo',description:'Offline fixture',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]}})
  if(body.method==='tools/call')return json(response,200,{jsonrpc:'2.0',id:body.id,result:{resultType:'complete',content:[{type:'text',text:'echo:'+body.params.arguments.text}]}})
  return json(response,200,{jsonrpc:'2.0',id:body.id,result:{ok:true}})
}

test('MCP configuration is empty by default, fixed, and rejects unsafe transports and headers',()=>{
  assert.deepEqual(normalizeMcpConfig(),[])
  for(const value of [null,{}, {servers:new Array(9).fill({})},{servers:[{name:'x',url:'http://10.0.0.1/mcp'}]}, {servers:[{name:'x',url:'https://user:pass@example.com'}]}, {servers:[{name:'x',url:'file:///tmp/key'}]}, {servers:[{name:'x',url:'https://example.com',headers:{Host:'other'}}]}, {servers:[{name:'x',url:'https://example.com',headers:{Authorization:'bad\r\nheader'}}]}, {servers:[{name:'x',url:'https://example.com'},{name:'x',url:'https://example.com'}]}])assert.throws(()=>normalizeMcpConfig(value))
  const proxy=new McpProxy({servers:[{name:'search',url:'https://example.com/mcp?private='+TOKEN,headers:{Authorization:'Bearer '+TOKEN}}]})
  assert.deepEqual(proxy.descriptors(jobs.a,'http://broker:3330'),[{name:'search',url:'http://broker:3330/jobs/job-a/mcp/search'}])
  assert.ok(!JSON.stringify(proxy.descriptors(jobs.a,'http://broker:3330')).includes(TOKEN))
})

test('fixed destination and host credentials replace all sandbox authentication and arbitrary headers',async()=>{
  const f=await fixture(normalServer)
  try{
    const response=await f.send({headers:{authorization:'Bearer attacker','x-api-key':'attacker','x-administrator':'attacker','x-extra':'attacker'}})
    assert.equal(response.status,200);await response.text()
    assert.equal(f.calls[0].url,'/fixed?token='+TOKEN)
    assert.equal(f.calls[0].headers.authorization,'Bearer '+TOKEN)
    assert.equal(f.calls[0].headers['x-administrator'],'trusted-value')
    assert.equal(f.calls[0].headers['x-api-key'],undefined);assert.equal(f.calls[0].headers['x-extra'],undefined)
    assert.notEqual(response.headers.get('mcp-session-id'),'remote-private-session')
    assert.match(response.headers.get('mcp-session-id'),/^mcp-[a-f0-9]+$/)
  }finally{await f.close()}
})

test('the actual DSH MCP transport discovers and calls tools through virtual per-job sessions',async()=>{
  const f=await fixture(normalServer),client=new Client({name:'prep-proxy-fixture',version:'1'},{versionNegotiation:{mode:'auto'}})
  const transport=new StreamableHTTPClientTransport(new URL(f.url+'/a'),{requestInit:{headers:{Authorization:'Bearer sandbox-job-capability'}}})
  try{
    await client.connect(transport)
    assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),['echo'])
    const result=await client.callTool({name:'echo',arguments:{text:'real-client-wire'}})
    assert.equal(result.content[0].text,'echo:real-client-wire')
    assert.match(transport.sessionId,/^mcp-/)
    assert.ok(f.calls.filter(call=>!['initialize','server/discover'].includes(call.body?.method)).every(call=>call.headers['mcp-session-id']==='remote-private-session'))
    assert.ok(f.calls.filter(call=>!['initialize','server/discover'].includes(call.body?.method)).every(call=>/^\d{4}-\d{2}-\d{2}$/.test(call.headers['mcp-protocol-version'])))
    const discover=f.calls.find(call=>call.body?.method==='server/discover')
    assert.equal(discover.headers['mcp-method'],'server/discover')
    await transport.terminateSession()
    assert.ok(f.calls.some(call=>call.method==='DELETE'&&call.headers.authorization==='Bearer '+TOKEN))
  }finally{await client.close();await f.close()}
})

test('modern-only MCP discovers and calls tools without a legacy initialize fallback',async()=>{
  const f=await fixture((request,response,body)=>{
    assert.notEqual(body?.method,'initialize','Modern service must not need a legacy handshake')
    if(body?.method==='server/discover')return json(response,200,{jsonrpc:'2.0',id:body.id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'modern-fixture',version:'1'}}}})
    return normalServer(request,response,body)
  })
  const client=new Client({name:'prep-modern-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}})
  const transport=new StreamableHTTPClientTransport(new URL(f.url+'/a'))
  try{
    await client.connect(transport)
    assert.equal((await client.listTools()).tools[0].name,'echo')
    assert.equal((await client.callTool({name:'echo',arguments:{text:'modern-wire'}})).content[0].text,'echo:modern-wire')
    const toolCall=f.calls.find(call=>call.body?.method==='tools/call')
    assert.equal(toolCall.headers['mcp-method'],'tools/call');assert.equal(toolCall.headers['mcp-name'],'echo')
    assert.equal(toolCall.headers['mcp-protocol-version'],'2026-07-28')
    assert.equal(transport.sessionId,undefined)
  }finally{await client.close();await f.close()}
})

test('a different job cannot use a virtual session and owner/session rebinding is rejected',async()=>{
  const f=await fixture(normalServer)
  try{
    const initial=await f.send(),session=initial.headers.get('mcp-session-id');await initial.text()
    const count=f.calls.length,response=await f.send({job:'b',body:rpc('tools/list'),session})
    assert.equal(response.status,404);assert.equal(f.calls.length,count)
    assert.throws(()=>f.proxy.state({...jobs.a,ownerId:jobs.b.ownerId}),/归属/)
    assert.throws(()=>f.proxy.state({...jobs.a,sessionId:jobs.b.sessionId}),/归属/)
  }finally{await f.close()}
})

test('JSON and fragmented SSE scrub configured credentials and response transport headers',async()=>{
  const f=await fixture((request,response,body)=>{
    if(body?.method==='initialize')return normalServer(request,response,body)
    if(request.method==='DELETE'){response.writeHead(204);response.end();return}
    const headers={'content-type':'text/event-stream','authorization':'Bearer '+TOKEN,'set-cookie':'secret='+TOKEN,location:'https://example.invalid/'+TOKEN,'x-private':TOKEN}
    response.writeHead(200,headers)
    const data=`id: cursor-1\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:2,result:{text:'中文 Bearer '+TOKEN}})}\r\n\r\n`
    const at=data.indexOf(TOKEN)+7
    response.write(data.slice(0,at));response.end(data.slice(at))
  })
  try{
    const initial=await f.send(),session=initial.headers.get('mcp-session-id');await initial.text()
    const response=await f.send({body:rpc('tools/list',2),session,headers:{'last-event-id':'cursor-0','mcp-protocol-version':'2025-03-26','mcp-param-custom':'fixture-metadata'}}),text=await response.text()
    assert.match(text,/中文 \[credential\]/);assert.ok(!text.includes(TOKEN))
    for(const header of ['authorization','set-cookie','location','x-private'])assert.equal(response.headers.get(header),null)
    assert.equal(f.calls.at(-1).headers['last-event-id'],'cursor-0')
    assert.equal(f.calls.at(-1).headers['mcp-protocol-version'],'2025-03-26')
    assert.equal(f.calls.at(-1).headers['mcp-param-custom'],'fixture-metadata')
    assert.equal(f.proxy.redact(f.proxy.servers.get('offline'),JSON.stringify({token:TOKEN})),JSON.stringify({token:'[credential]'}))
  }finally{await f.close()}
})

test('stateless MCP services remain usable without inventing a session requirement',async()=>{
  const f=await fixture((request,response,body)=>{
    if(body?.method==='initialize')return json(response,200,{jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'stateless-fixture',version:'1'}}})
    return normalServer(request,response,body)
  })
  try{
    const initial=await f.send();assert.equal(initial.headers.get('mcp-session-id'),null);await initial.text()
    const next=await f.send({body:rpc('tools/list')});assert.equal(next.status,200);assert.equal((await next.json()).result.tools[0].name,'echo')
    assert.ok(f.calls.every(call=>call.headers['mcp-session-id']===undefined))
  }finally{await f.close()}
})

test('upstream HTTP redirects are refused without visiting the new destination',async()=>{
  let visits=0
  const target=http.createServer((_req,response)=>{visits++;response.end('should never reach')})
  const targetURL=await listen(target),f=await fixture((_request,response)=>{response.writeHead(307,{location:targetURL});response.end()})
  try{
    const response=await f.send();assert.equal(response.status,502);assert.equal(visits,0)
    assert.ok(!(await response.text()).includes(targetURL))
  }finally{await f.close();await close(target)}
})

test('malformed JSON, methods, protocol headers and oversized requests never reach the service',async()=>{
  const f=await fixture(normalServer,{maxRequestBytes:256})
  try{
    for(const [options,status] of [[{method:'PUT'},405],[{body:'not json'},400],[{body:rpc('tools/list')},400],[{body:'a'.repeat(300)},413],[{headers:{'content-type':'text/plain'}},415],[{headers:{'mcp-protocol-version':'not-a-date'}},400],[{body:[]},400]]){
      const response=await f.send(options);assert.equal(response.status,status);await response.text()
    }
    assert.equal(f.calls.length,0)
  }finally{await f.close()}
})

test('per-job request and response size limits bound MCP traffic',async()=>{
  const f=await fixture(normalServer,{maxRequests:1})
  try{
    const first=await f.send();await first.text()
    const second=await f.send();assert.equal(second.status,429);await second.text();assert.equal(f.calls.length,1)
  }finally{await f.close()}
  const large=await fixture((_request,response)=>{response.writeHead(200,{'content-type':'application/json','content-length':1000});response.end('x'.repeat(1000))},{maxResponseBytes:100})
  try{const response=await large.send();assert.equal(response.status,502);assert.match(await response.text(),/响应过大/)}finally{await large.close()}
})

test('cancelling interrupts live MCP traffic and cleanup ends only that job remote sessions',async()=>{
  let streamingResolve
  const streaming=new Promise(ok=>{streamingResolve=ok})
  const f=await fixture(async(request,response,body)=>{
    if(request.method==='GET'){response.writeHead(200,{'content-type':'text/event-stream'});response.write('event: ping\ndata: {}\n\n');streamingResolve();return}
    return normalServer(request,response,body)
  })
  try{
    const a=await f.send(),sessionA=a.headers.get('mcp-session-id');await a.text()
    const b=await f.send({job:'b'});await b.text()
    const response=await f.send({method:'GET',session:sessionA});await streaming
    const read=response.text();f.proxy.cancelJob(jobs.a)
    await assert.rejects(read)
    await f.proxy.releaseJob(jobs.a)
    assert.equal(f.calls.filter(call=>call.method==='DELETE').length,1)
    assert.equal(f.calls.at(-1).headers.authorization,'Bearer '+TOKEN)
    assert.equal(f.proxy.jobs.has(jobs.a.id),false);assert.equal(f.proxy.jobs.has(jobs.b.id),true)
  }finally{await f.close()}
})

test('upstream inactivity is bounded and errors never disclose the target or authentication',async()=>{
  const f=await fixture((_request,_response)=>{}, {timeoutMs:25})
  try{
    const response=await f.send();assert.ok([502,504].includes(response.status))
    const text=await response.text();assert.ok(!text.includes(TOKEN));assert.ok(!text.includes(f.remoteURL))
    await delay(5);assert.equal(f.proxy.state(jobs.a).controllers.size,0)
  }finally{await f.close()}
})
