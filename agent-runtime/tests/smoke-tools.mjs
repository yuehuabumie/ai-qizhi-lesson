/**
 * Offline integration fixture for the real preparation Docker image.
 * Mount this file as /app/smoke-tools.mjs and run it with Node inside the image.
 * Use --network none, writable /state and /work, and an executable /tmp tmpfs
 * (the DSH native-module loader copies its .node library into a temp directory).
 *
 * The model replies below are fixed test data, not an AI/model acceptance test.
 * No real API key, production API, teaching mutation or external network is used.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
let engineModule
for (const candidate of [new URL('./runtime-engine.mjs', import.meta.url), new URL('../runtime-engine.mjs', import.meta.url)]) {
  try { await access(candidate); engineModule = candidate; break } catch {}
}
assert.ok(engineModule, 'The fixture requires runtime-engine.mjs beside it or in its parent directory')
const { Agent: DeepSeekHarness } = await (await import(engineModule.href)).loadRuntime()

const MODEL='deepseek-flash'
const KEY_ENV='AIQ_OFFLINE_SMOKE_KEY'
const DUMMY_KEY='offline-fixture-only-not-a-provider-key'
const SESSION='offline-prep-tools-session'
const CALL='offline-terminal-call'
const FIRST_PROMPT='OFFLINE_CONTEXT_SENTINEL:lesson-qa. Run the local terminal fixture, then report its result.'
const FOLLOWUP='OFFLINE_FOLLOWUP:check the restored conversation context.'
const FIRST_REPLY='offline-tools-verified'
const RESTORED_REPLY='context-restored'
const COMMAND=`python3 -c "import docx, openpyxl, pptx, pypdf, PIL; print('OFFLINE_TERMINAL_OK')" && libreoffice --headless --version`
const requiredTeachingTools=['create_classroom','export_file','generate_lesson_image']

const parent=resolve(process.env.PREP_SMOKE_DIR||tmpdir())
const root=await mkdtemp(join(parent,'aiq-prep-offline-'))
assert.ok(root.startsWith(parent+sep),'The fixture owns only its fresh temporary directory')
const here=dirname(fileURLToPath(import.meta.url))
let lessonPlugin
for(const candidate of [join(here,'lesson-plugin.mjs'),join(here,'..','lesson-plugin.mjs')]){
  try{await access(candidate);lessonPlugin=candidate;break}catch{}
}
assert.ok(lessonPlugin,'The image must contain the actual lesson-plugin.mjs')

let count=0,mockFailure,selectedTool,toolResultSeen=false,contextSeen=false
const observedNotifications=[]
const messageBlocks=body=>(body.messages||[]).flatMap(message=>Array.isArray(message.content)?message.content:[])
const textOf=value=>typeof value==='string'?value:Array.isArray(value)?value.map(textOf).join('\n'):value&&typeof value==='object'?typeof value.text==='string'?value.text:textOf(value.content):''

function emitMessage(response,{tool,text}){
  const events=[{type:'message_start',message:{id:`offline-message-${count}`,type:'message',role:'assistant',model:MODEL,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}}]
  if(tool){
    events.push(
      {type:'content_block_start',index:0,content_block:{type:'tool_use',id:CALL,name:tool.name,input:{}}},
      {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.arguments)}},
    )
  }else{
    events.push(
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
    )
  }
  events.push(
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}},
    {type:'message_stop'},
  )
  response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'})
  response.end(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

function terminalCall(tools){
  // Discover the actual native tool name and argument schema emitted by DSH.
  const candidates=tools.filter(tool=>{
    const schema=tool.input_schema||tool.parameters
    return schema?.type==='object'&&schema.properties?.command?.type==='string'
      && /bash|terminal|shell/i.test(tool.name)
  })
  const tool=candidates.find(value=>value.name==='bash')||candidates[0]
  assert.ok(tool,'The real SDK profile must expose a terminal command tool')
  const schema=tool.input_schema||tool.parameters
  const args={command:COMMAND,description:'离线验收终端与文档处理依赖'}
  for(const field of schema.required||[]){
    if(Object.hasOwn(args,field))continue
    const parameter=schema.properties?.[field]
    assert.ok(parameter&&Object.hasOwn(parameter,'default'),`Unexpected required terminal argument: ${field}`)
    args[field]=parameter.default
  }
  selectedTool=tool.name
  return {name:tool.name,arguments:args}
}

const server=createServer((request,response)=>{
  void (async()=>{
    assert.equal(request.method,'POST','Only model Messages requests are expected')
    assert.equal(new URL(request.url,'http://127.0.0.1').pathname,'/v1/messages')
    assert.equal(request.headers['x-api-key'],DUMMY_KEY,'Only the fixture credential may reach loopback')
    const parts=[];let size=0
    for await(const part of request){size+=part.length;assert.ok(size<4*1024*1024,'Model fixture request size');parts.push(part)}
    const body=JSON.parse(Buffer.concat(parts).toString('utf8'))
    assert.equal(body.model,MODEL)
    assert.equal(body.stream,true,'Exercise the actual Anthropic Messages SSE decoder')
    count++
    assert.ok(count<=3,'Unexpected extra model call: fixed fixture must finish in three requests')
    if(count===1){
      assert.ok(Array.isArray(body.tools),'Model request must include actual registered native tools')
      const names=new Set(body.tools.map(tool=>tool.name))
      for(const name of requiredTeachingTools)assert.ok(names.has(name),`Teaching tool must be model-visible: ${name}`)
      assert.ok(textOf(messageBlocks(body)).includes(FIRST_PROMPT),'The first prompt must reach the real request')
      return emitMessage(response,{tool:terminalCall(body.tools)})
    }
    const result=messageBlocks(body).find(block=>block.type==='tool_result'&&block.tool_use_id===CALL)
    assert.ok(result,'The subsequent request must contain the terminal tool_result')
    assert.notEqual(result.is_error,true,'The real terminal tool must succeed')
    const output=textOf(result.content)
    // The marker must be a standalone output line, not echoed command source.
    assert.match(output,/(?:^|\r?\n)OFFLINE_TERMINAL_OK(?:\r?\n|$)/,'All document-library imports must actually execute')
    assert.match(output,/LibreOffice\s+\d/,'The image LibreOffice executable must run')
    toolResultSeen=true
    if(count===2)return emitMessage(response,{text:FIRST_REPLY})
    const historyText=textOf(messageBlocks(body))
    assert.ok(historyText.includes(FIRST_PROMPT),'A fresh Harness must resume the first user message')
    assert.ok(historyText.includes(FIRST_REPLY),'A fresh Harness must resume the committed assistant reply')
    assert.ok(historyText.includes(FOLLOWUP),'The new follow-up must also be present')
    contextSeen=true
    return emitMessage(response,{text:RESTORED_REPLY})
  })().catch(error=>{
    mockFailure??=error
    if(!response.headersSent)response.writeHead(400,{'content-type':'application/json'})
    response.end(JSON.stringify({error:{type:'invalid_request_error',message:error.message}}))
  })
})

let first,second
async function bounded(promise,label){
  let timer
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} exceeded the offline fixture deadline`)),120000)})])}
  finally{clearTimeout(timer)}
}
function assertMock(){if(mockFailure)throw mockFailure}

try{
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)})
  const baseURL=`http://127.0.0.1:${server.address().port}`
  const patch=join(root,'offline.patch.yml')
  await writeFile(patch,JSON.stringify([
    {id:'llm-deepseek',config:{baseURL,apiKeyEnv:KEY_ENV,thinking:'disabled',reasoningEffort:'off',maxTokens:1024,retryPolicy:{mode:'normal',maxRetries:0}}},
    {id:'tools',config:{mode:'native'}},
    {id:'session-log-deepseek',disabled:true},
    {id:'plugin-package-inventory-deepseek',disabled:true},
    {id:'web-deepseek-api',disabled:true},
    {id:'tool-plugin-manager',disabled:true},
    {insert:[{id:'aiq-offline-teaching',name:lessonPlugin}]},
  ]))
  const childEnv={...process.env,[KEY_ENV]:DUMMY_KEY,DSH_TELEMETRY_DISABLED:'1',DSH_PERMISSION_MODE:'danger-full-access',DSH_PRIMARY_RUNTIME:'',HTTP_PROXY:'',HTTPS_PROXY:'',http_proxy:'',https_proxy:'',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'}
  delete childEnv.DEEPSEEK_API_KEY
  delete childEnv.DEEPSEEK_BASE_URL
  delete childEnv.PREP_JOB_TOKEN
  delete childEnv.PREP_WORKER_SECRET
  const options={profile:'sdk',patches:[patch],dshHome:join(root,'home'),processCwd:root,cwd:root,model:MODEL,provider:'deepseek-official',maxTokens:1024,reasoningEffort:'off',env:childEnv,initializeTimeoutMs:60000,requestTimeoutMs:60000}

  first=new DeepSeekHarness(options)
  const session=first.session(SESSION)
  await session.setWorkingDirectory(root)
  const initial=await bounded(session.run(FIRST_PROMPT,{onNotification:notification=>observedNotifications.push(notification)}),'Initial terminal run')
  await first.client.request('session/wait',{sessionId:SESSION})
  assertMock()
  assert.equal(initial.finalResponse,FIRST_REPLY)
  assert.ok(toolResultSeen,'The model must receive the result of a real terminal invocation')
  const events=observedNotifications.filter(notification=>notification.method==='session.event').map(notification=>notification.params.event)
  assert.ok(events.some(event=>event.type==='tool/call'&&event.data.name===selectedTool&&event.data.callId===CALL),'SDK notifications must expose the real tool call')
  assert.ok(events.some(event=>event.type==='tool/result'&&event.data.message?.toolCallId===CALL&&!event.data.message.isError&&textOf(event.data.message.content).includes('OFFLINE_TERMINAL_OK')),'SDK notifications must expose the successful real tool result')
  await first.close();first=undefined

  second=new DeepSeekHarness(options)
  const restored=await second.resumeSession(SESSION)
  const followup=await bounded(restored.run(FOLLOWUP),'Restored conversation run')
  await second.client.request('session/wait',{sessionId:SESSION})
  assertMock()
  assert.equal(followup.finalResponse,RESTORED_REPLY)
  assert.ok(contextSeen,'The mock must inspect the actual restored wire history')
  assert.equal(count,3)
  console.log('PASS offline SDK smoke: model-visible teaching tools, real PTY/Python document imports, LibreOffice, tool notifications, final text, durable session resume')
  console.log('FIXTURE ONLY: fixed loopback responses; no real DeepSeek model or production AI acceptance was performed.')
}finally{
  await Promise.allSettled([first?.close(),second?.close()])
  server.closeAllConnections()
  await new Promise(ok=>server.close(ok))
  await rm(root,{recursive:true,force:true})
}
