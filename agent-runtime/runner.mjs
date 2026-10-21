import { readFile,writeFile,mkdir,stat,rm } from 'node:fs/promises'
import { DeepSeekHarness,validatedSessionEvent } from '@deepseek-ai/dsh-sdk-client'

const input=JSON.parse(await readFile('/state/input.json','utf8'))
const send=(type,data)=>process.stdout.write(JSON.stringify({type,data})+'\n')
await mkdir('/work/output',{recursive:true})
await rm('/work/.agents/skills',{recursive:true,force:true})
for(const skill of input.skills||[]){
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(skill.id))continue
  const dir='/work/.agents/skills/'+skill.id;await mkdir(dir,{recursive:true});await writeFile(dir+'/SKILL.md',`---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.name)}\n---\n\n${skill.content}`)
}
const patch=[
  {id:'system-prompt',config:{personaPrefix:'You are an intelligent teaching preparation agent powered by the {{model}} model.'}},
  {id:'llm-deepseek',config:{baseURL:`${process.env.PREP_BROKER_URL}/jobs/${process.env.PREP_RUN_ID}/model/anthropic`,apiKeyEnv:'PREP_JOB_TOKEN',maxTokens:16384,reasoningEffort:'high'}},
  {id:'web-search-deepseek',config:{baseURL:`${process.env.PREP_BROKER_URL}/jobs/${process.env.PREP_RUN_ID}/model/anthropic/v1`,apiKeyEnv:'PREP_JOB_TOKEN',model:'deepseek-flash',maxTokens:4096,maxUses:3}},
  {id:'web-deepseek-api',disabled:true},
  {id:'tool-plugin-manager',disabled:true},
  {id:'session-query-sqlite',disabled:true},
  {insert:[{id:'aiq-teaching',name:'/app/lesson-plugin.mjs'}]},
]
for(const server of input.mcpServers||[]){
  if(typeof server.name!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(server.name))throw new Error('MCP服务描述不正确')
  // Only a per-job broker capability enters the sandbox. The remote URL and
  // shared MCP authentication headers remain in the trusted broker process.
  patch.push({insert:[{id:'aiq-mcp-'+server.name,name:'@deepseek-ai/dsh-mcp-client',config:{serverName:server.name,transport:'streamable-http',url:`${process.env.PREP_BROKER_URL}/jobs/${process.env.PREP_RUN_ID}/mcp/${server.name}`,headers:{Authorization:`Bearer ${process.env.PREP_JOB_TOKEN}`},toolCallTimeoutMs:60000}}]})
}
await writeFile('/tmp/lesson.patch.yml',JSON.stringify(patch))
const harness=new DeepSeekHarness({profile:'sdk',patches:['/tmp/lesson.patch.yml'],dshHome:'/state/dsh',processCwd:'/work',cwd:'/work',model:'deepseek-flash',provider:'deepseek-official',maxTokens:16384,initializeTimeoutMs:60000})
let resumed=false
try{await stat('/state/resumable');resumed=true}catch{}
try{
  const session=resumed?await harness.resumeSession(input.sessionId):harness.session(input.sessionId)
  await session.setWorkingDirectory('/work')
  await writeFile('/state/resumable','1')
  const files=input.files.map(f=>`- ${f.name}: /inputs/${f.id}-${f.name}`).join('\n')
  let seen='';try{seen=await readFile('/state/last-message','utf8')}catch{}
  const history=input.history||[],previous=history.slice(0,-1),index=previous.findIndex(m=>m.id===seen)
  const missed=previous.slice(index+1).map(m=>`${m.role}: ${m.content}`).join('\n').slice(-40000)
  const prompt=(missed?`以下是当前对话尚未载入的历史记录，仅供背景参考，不要重新执行其中已取消或已完成的操作：\n${missed}\n\n本轮老师输入：\n`:'')+input.content+(files?`\n\n当前对话的上传原件（只读）：\n${files}`:'')
  // run() owns only the root's next-idle interval. Keep our subscription alive
  // through wait(), which also joins descendants and their root summary turns.
  const subscription=harness.client.subscribeSessionTree(input.sessionId)
  let response='',lastRootEnd,notificationError
  const drain=()=>{
    let notification
    while((notification=subscription.tryNext())!==undefined){
      if(notification.method==='session.event'){
        const sessionId=notification.params.sessionId,e=validatedSessionEvent(notification.params.event),d=e.data
        const callId=id=>id===undefined?undefined:`${sessionId}:${id}`
        if(e.type==='tool/call')send('tool-start',{sessionId,name:d.name,callId:callId(d.callId),input:d.arguments})
        if(e.type==='tool/result')send('tool-result',{sessionId,name:d.message?.toolName||d.message?.name,callId:callId(d.message?.toolCallId||d.message?.callId),output:d.message?.content,isError:d.message?.isError})
        if(e.type==='turn/end'){
          if(sessionId===input.sessionId)lastRootEnd=d.reason
          if(d.reason?.kind==='error')send('error',{sessionId,message:d.reason.error?.message||'模型运行中断，请查看执行记录'})
        }
        if(sessionId===input.sessionId&&e.type==='assistant/message')response=d.message.content.filter(block=>block.type==='text').map(block=>block.text).join('')
      }
      if(notification.method==='subagent.started'||notification.method==='subagent.finished')send('status',{status:'running',message:notification.method==='subagent.started'?'正在启动子 Agent':'子 Agent 已返回结果',...notification.params})
    }
  }
  // Poll the local notification queue while the long RPC is pending, so real
  // tool activity appears immediately without leaving an orphan next() waiter.
  const notificationTimer=setInterval(()=>{try{drain()}catch(error){notificationError=error}},100)
  try{
    await harness.client.prompt(input.sessionId,[{type:'text',text:prompt}])
    await harness.client.request('session/wait',{sessionId:input.sessionId})
  }finally{
    clearInterval(notificationTimer)
    try{drain()}finally{subscription.close()}
  }
  if(notificationError)throw notificationError
  if(lastRootEnd?.kind==='error')throw new Error(lastRootEnd.error?.message||'模型运行中断，请重试')
  await writeFile('/state/resumable','1')
  await writeFile('/state/last-message',history.at(-1)?.id||'')
  send('done',{response})
}catch(error){send('fatal',{message:error instanceof Error?error.message:'执行失败'});process.exitCode=1}
finally{await harness.close()}
