/**
 * Keyless real-Harness MCP integration, inside the actual preparation image.
 * Mount this file at /app/smoke-mcp.mjs AND the current mcp-proxy.mjs at
 * /app/mcp-proxy.mjs (the existing image may not contain that new module).
 * Run Node with --network none, writable /state and /work, and an executable
 * /tmp tmpfs for the native DSH loader. Only loopback fixture servers are used.
 * The fixed model SSE is test data, not a real-model or production acceptance.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { access, mkdtemp, writeFile, rm, realpath, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const MODEL='deepseek-flash', KEY_ENV='AIQ_OFFLINE_MCP_KEY'
const MODEL_KEY='offline-mcp-fixture-not-a-provider-key'
const JOB_TOKEN='offline-mcp-job-capability-'+randomBytes(12).toString('hex')
const HOST_TOKEN='offline-mcp-host-secret-'+randomBytes(12).toString('hex')
const REMOTE_SESSION='remote-private-session-'+randomBytes(12).toString('hex')
const TOOL='mcp__offline__echo', CALL='offline-mcp-call', ARG='lesson-echo-sentinel'
const RESULT='OFFLINE_MCP_ECHO:'+ARG, FINAL='offline-mcp-verified'
const SESSION='offline-mcp-session'
const job={id:'offline_mcp_job',ownerId:'offline_mcp_owner',sessionId:SESSION}
const parent=resolve(process.env.PREP_SMOKE_DIR||tmpdir())
let proxyModule
for(const candidate of [new URL('./mcp-proxy.mjs',import.meta.url),new URL('../mcp-proxy.mjs',import.meta.url)]){
  try{await access(candidate);proxyModule=candidate;break}catch{}
}
assert.ok(proxyModule,'Mount the actual mcp-proxy.mjs at /app/mcp-proxy.mjs')
const {McpProxy}=await import(proxyModule.href)
const root=await mkdtemp(join(parent,'aiq-mcp-offline-'))
assert.ok(root.startsWith(parent+sep),'Only a freshly created fixture directory may be used')
const requests=[],notifications=[],modelBodies=[],mcpMethods=[],gatewaySessions=[]
let failure,count=0,harness,proxy,modelServer,mcpServer,gatewayServer,toolResultSeen=false
const redact=value=>[HOST_TOKEN,JOB_TOKEN,MODEL_KEY,REMOTE_SESSION].reduce((text,secret)=>text.replaceAll(secret,'[fixture-credential]'),String(value))
const textOf=value=>typeof value==='string'?value:Array.isArray(value)?value.map(textOf).join('\n'):value&&typeof value==='object'?typeof value.text==='string'?value.text:textOf(value.content):''
const blocks=body=>(body.messages||[]).flatMap(message=>Array.isArray(message.content)?message.content:[])
async function listen(server){await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});return `http://127.0.0.1:${server.address().port}`}
async function readJSON(request){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;assert.ok(size<4*1024*1024,'Fixture input size');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
function guarded(run,response){void run().catch(error=>{failure??=error;if(!response.headersSent)response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:redact(error.message)}}))})}
function rpc(response,id,result,{error,session=false}={}){
  response.writeHead(200,{'content-type':'application/json',...(session?{'mcp-session-id':REMOTE_SESSION}:{})})
  response.end(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})}))
}
function modelReply(response,{tool,text}){
  const frames=[{type:'message_start',message:{id:'offline-mcp-message-'+count,type:'message',role:'assistant',model:MODEL,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}}]
  if(tool)frames.push({type:'content_block_start',index:0,content_block:{type:'tool_use',id:CALL,name:TOOL,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({text:ARG})}})
  else frames.push({type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text}})
  frames.push({type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}},{type:'message_stop'})
  response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'})
  response.end(frames.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,no)=>{timer=setTimeout(()=>no(new Error(label+' exceeded the offline deadline')),120000)})])}finally{clearTimeout(timer)}}

try{
  // A legacy Streamable HTTP fixture with a genuine server-side session.
  // Auto-negotiating clients can probe server/discover and fall back to initialize.
  mcpServer=createServer((request,response)=>guarded(async()=>{
    assert.ok(request.headers.authorization==='Bearer '+HOST_TOKEN,'Only the proxy may attach the upstream credential')
    requests.push({method:request.method,session:request.headers['mcp-session-id']})
    if(request.method==='GET'){assert.ok(request.headers['mcp-session-id']===REMOTE_SESSION,'GET uses the real upstream session');response.writeHead(405,{'content-type':'application/json'});response.end('{}');return}
    if(request.method==='DELETE'){assert.ok(request.headers['mcp-session-id']===REMOTE_SESSION,'DELETE uses the real upstream session');response.writeHead(204);response.end();return}
    assert.equal(request.method,'POST')
    const message=await readJSON(request);mcpMethods.push(message.method)
    assert.equal(message.jsonrpc,'2.0')
    if(message.method==='server/discover')return rpc(response,message.id,null,{error:{code:-32601,message:'Legacy offline fixture'}})
    if(message.method==='initialize'){
      assert.ok(!request.headers['mcp-session-id'],'Initialization must not reuse an old session')
      return rpc(response,message.id,{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'offline-echo-fixture',version:'1'}},{session:true})
    }
    assert.ok(request.headers['mcp-session-id']===REMOTE_SESSION,'Only a translated upstream session may reach MCP')
    if(message.method==='notifications/initialized'){response.writeHead(202);response.end();return}
    if(message.method==='notifications/cancelled'){response.writeHead(202);response.end();return}
    if(message.method==='tools/list')return rpc(response,message.id,{tools:[{name:'echo',description:'Offline echo fixture.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]})
    if(message.method==='tools/call'){
      assert.equal(message.params.name,'echo');assert.equal(message.params.arguments.text,ARG)
      return rpc(response,message.id,{content:[{type:'text',text:RESULT},{type:'text',text:'Host credential redaction probe: '+HOST_TOKEN}]})
    }
    return rpc(response,message.id,null,{error:{code:-32601,message:'Unsupported offline method'}})
  },response))
  const upstream=await listen(mcpServer)
  proxy=new McpProxy({servers:[{name:'offline',url:upstream+'/mcp',headers:{Authorization:'Bearer '+HOST_TOKEN}}]},{timeoutMs:10000})
  gatewayServer=createServer((request,response)=>guarded(async()=>{
    assert.ok(request.headers.authorization==='Bearer '+JOB_TOKEN,'Harness uses only its job-scoped capability')
    assert.equal(new URL(request.url,'http://127.0.0.1').pathname,`/jobs/${job.id}/mcp/offline`)
    gatewaySessions.push(request.headers['mcp-session-id'])
    await proxy.handle(job,'offline',request,response)
  },response))
  const gateway=await listen(gatewayServer)
  modelServer=createServer((request,response)=>guarded(async()=>{
    assert.equal(request.method,'POST');assert.equal(new URL(request.url,'http://127.0.0.1').pathname,'/v1/messages')
    assert.ok(request.headers['x-api-key']===MODEL_KEY,'Only the loopback dummy model credential is used')
    const body=await readJSON(request),wire=JSON.stringify(body)
    assert.ok(!wire.includes(HOST_TOKEN),'Upstream shared MCP credential must never enter the model context')
    assert.ok(!wire.includes(REMOTE_SESSION),'Upstream session identifiers must not enter model context')
    modelBodies.push(body);assert.equal(body.model,MODEL);assert.equal(body.stream,true)
    count++;assert.ok(count<=2,'The fixed fixture finishes in exactly two model requests')
    if(count===1){
      assert.ok(body.tools.some(tool=>tool.name===TOOL),'The real MCP tool must be present in the model wire tool list')
      return modelReply(response,{tool:true})
    }
    const result=blocks(body).find(block=>block.type==='tool_result'&&block.tool_use_id===CALL)
    assert.ok(result,'The MCP tool result must reach the actual subsequent model request')
    assert.notEqual(result.is_error,true,'The real MCP tool call must succeed')
    assert.ok(textOf(result.content).includes(RESULT),'The actual remote echo result must reach the model')
    assert.ok(textOf(result.content).includes('[credential]'),'The real broker proxy must scrub the upstream credential in tool output')
    toolResultSeen=true;return modelReply(response,{text:FINAL})
  },response))
  const baseURL=await listen(modelServer)
  const patch=join(root,'offline-mcp.patch.yml')
  await writeFile(patch,JSON.stringify([
    {id:'llm-deepseek',config:{baseURL,apiKeyEnv:KEY_ENV,thinking:'disabled',reasoningEffort:'off',maxTokens:1024,retryPolicy:{mode:'normal',maxRetries:0}}},
    {id:'tools',config:{mode:'native'}},
    {id:'session-log-deepseek',disabled:true},{id:'plugin-package-inventory-deepseek',disabled:true},
    {id:'web-deepseek-api',disabled:true},{id:'tool-plugin-manager',disabled:true},
    {insert:[{id:'offline-mcp',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'offline',transport:'streamable-http',url:proxy.descriptors(job,gateway)[0].url,headers:{Authorization:'Bearer '+JOB_TOKEN},toolCallTimeoutMs:10000,failOnStartupError:true,reconnect:{enabled:false}}}]},
  ]))
  const childEnv={...process.env,[KEY_ENV]:MODEL_KEY,DSH_TELEMETRY_DISABLED:'1',DSH_PERMISSION_MODE:'danger-full-access',DSH_PRIMARY_RUNTIME:'',HTTP_PROXY:'',HTTPS_PROXY:'',http_proxy:'',https_proxy:'',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'}
  for(const key of ['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','PREP_JOB_TOKEN','PREP_WORKER_SECRET'])delete childEnv[key]
  harness=new DeepSeekHarness({profile:'sdk',patches:[patch],dshHome:join(root,'home'),processCwd:root,cwd:root,model:MODEL,provider:'deepseek-official',maxTokens:1024,reasoningEffort:'off',env:childEnv,initializeTimeoutMs:60000,requestTimeoutMs:60000})
  const session=harness.session(SESSION);await session.setWorkingDirectory(root)
  const run=await bounded(session.run('OFFLINE MCP FIXTURE: call the registered echo tool with the fixture value and report its result.',{onNotification:value=>notifications.push(value)}),'MCP run')
  await harness.client.request('session/wait',{sessionId:SESSION})
  if(failure)throw failure
  assert.equal(run.finalResponse,FINAL);assert.ok(toolResultSeen);assert.equal(count,2)
  const events=notifications.filter(value=>value.method==='session.event').map(value=>value.params.event)
  assert.ok(events.some(event=>event.type==='tool/call'&&event.data.name===TOOL&&event.data.callId===CALL),'Real Harness notifications must expose the MCP tool call')
  assert.ok(events.some(event=>event.type==='tool/result'&&event.data.message?.toolCallId===CALL&&!event.data.message.isError&&textOf(event.data.message.content).includes(RESULT)),'Real Harness notifications must expose the successful MCP tool result')
  assert.ok(mcpMethods.includes('initialize')&&mcpMethods.includes('notifications/initialized')&&mcpMethods.includes('tools/list')&&mcpMethods.includes('tools/call'))
  assert.ok(requests.some(value=>value.method==='GET'),'The real SDK must tolerate a 405 standalone SSE endpoint')
  assert.ok(gatewaySessions.some(value=>typeof value==='string'&&value.startsWith('mcp-')&&value!==REMOTE_SESSION),'The actual SDK must use the broker virtual session')
  assert.ok(gatewaySessions.every(value=>value!==REMOTE_SESSION),'No upstream session may be exposed to the Harness')
  await harness.close();harness=undefined
  await proxy.releaseJob(job)
  assert.ok(requests.some(value=>value.method==='DELETE'),'Releasing the job terminates its real upstream MCP session')
  assert.ok(!JSON.stringify(modelBodies).includes(HOST_TOKEN),'Shared upstream credentials stay outside all model requests')
  if(failure)throw failure
  console.log('PASS offline MCP smoke: actual Harness registration, wire tools, remote echo call, real tool notifications/results, virtual sessions, GET405, DELETE cleanup and credential redaction')
  console.log('FIXTURE ONLY: loopback fake model/MCP, network none, no real API key or production endpoint.')
}catch(error){throw new Error(redact(error.message))}
finally{
  await harness?.close().catch(()=>{})
  await proxy?.releaseJob(job).catch(()=>{})
  for(const server of [gatewayServer,modelServer,mcpServer])if(server?.listening){server.closeAllConnections();await new Promise(ok=>server.close(ok))}
  assert.equal(await realpath(root),resolve(root));assert.ok(root.startsWith(parent+sep));assert.ok(!(await lstat(root)).isSymbolicLink())
  await rm(root,{recursive:true,force:true})
}
