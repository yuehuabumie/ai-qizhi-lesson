import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { env } from '../env.js'
import { requireUser } from '../lib/auth.js'
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors.js'
import { parseBody } from '../lib/validate.js'
import { enforce } from '../lib/rate-limit.js'
import { redis, rk } from '../lib/redis.js'
import { attachmentDto, readAttachment, removeAttachment, storeAttachment } from '../lib/prep-storage.js'
import { executeTeaching, isTeachingRead, parseTeaching, previewTeaching, proposalVersion } from '../lib/prep-tools.js'
import { generateTeachingImage } from '../lib/prep-tools.js'

const runnableStates=['queued','running','waiting']
const activeStates=[...runnableStates,'cancelling']
const idField=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)
const decode=(value:string|null|undefined,fallback:any={})=>{try{return JSON.parse(value||'')}catch{return fallback}}
const messageDto=(m:any)=>({...m,attachmentIds:decode(m.attachmentIds,[])})
const proposalDto=(p:any)=>({...p,payload:decode(p.payload),preview:decode(p.preview),result:decode(p.result,null)})
const eventDto=(e:any)=>({...e,data:decode(e.data)})
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const conflict=(message:string)=>new ApiError('CONFLICT',message)
const paramId=(req:FastifyRequest,name='id')=>parseBody(idField,(req.params as Record<string,string>)[name])
const configured=()=>env.PREP_ENABLED && !!env.PREP_WORKER_SECRET
async function ownSession(ownerId:string,id:string){
  const session=await prisma.prepSession.findFirst({where:{id,ownerId}})
  if(!session)throw notFound('对话不存在或已删除')
  return session
}
async function event(sessionId:string,runId:string|null,type:string,data:unknown){
  return prisma.prepEvent.create({data:{sessionId,runId,type,data:JSON.stringify(data)}})
}
function workerAuth(req:FastifyRequest){
  const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${env.PREP_WORKER_SECRET||''}`)
  if(!env.PREP_WORKER_SECRET||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw forbidden()
}
async function worker(path:string,method='GET',body?:unknown,timeout=45000){
  if(!configured())throw badRequest('智能备课运行器尚未配置')
  const response=await fetch(`${env.PREP_WORKER_URL.replace(/\/$/,'')}${path}`,{method,headers:{authorization:`Bearer ${env.PREP_WORKER_SECRET}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)})
  if(!response.ok)throw new Error(`备课运行器响应 ${response.status}`)
  return response.json() as Promise<any>
}
function requireConfigured(){if(!configured())throw badRequest('智能备课尚未启用，请联系管理员配置运行器和模型')}

/** Durable queue. Browser connections never own the running job. */
export async function prepRoutes(app:FastifyInstance){
  const controllers=new Map<string,AbortController>()
  let closing=false,pumping=false
  const lockOwner=randomBytes(16).toString('hex')

  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:env.PREP_MAX_FILE_MB*1024*1024},(_req,body,done)=>done(null,body))
  app.addHook('preHandler',async req=>{
    if(req.url.startsWith('/api/prep/')&&!req.url.startsWith('/api/prep/internal/')&&req.method!=='GET'&&req.headers.origin&&req.headers.origin!==new URL(env.APP_ORIGIN).origin)throw forbidden('请求来源不正确')
  })

  async function lockedRun(tx:Prisma.TransactionClient,id:string){
    await tx.$queryRaw`SELECT id FROM prep_runs WHERE id=${id} FOR UPDATE`
    return tx.prepRun.findUnique({where:{id}})
  }
  async function requestStop(id:string,error?:string,blockExecuting=false){
    return prisma.$transaction(async tx=>{
      const run=await lockedRun(tx,id)
      if(!run)return run
      // A confirmed business write has already crossed its commit boundary.
      // Never promise that stopping the model can undo that write.
      if(blockExecuting&&await tx.prepProposal.count({where:{runId:id,status:'executing'}}))throw conflict('已确认的班级或作业操作正在执行，请等待完成后再停止')
      if(!activeStates.includes(run.status))return run
      if(run.status==='cancelling')return run
      const stopped=await tx.prepRun.update({where:{id},data:{status:'cancelling',error:error?.slice(0,1000)||null}})
      await tx.prepProposal.updateMany({where:{runId:id,status:'pending'},data:{status:error?'expired':'rejected',result:JSON.stringify(error?{error}:{cancelled:true})}})
      await tx.prepEvent.create({data:{sessionId:run.sessionId,runId:id,type:'status',data:JSON.stringify({status:'cancelling',message:error?'执行遇到问题，正在停止隔离任务':'正在停止隔离任务'})}})
      return stopped
    })
  }
  async function finishStopping(id:string){
    const run=await prisma.prepRun.findUnique({where:{id}})
    if(!run||run.status!=='cancelling')return false
    // A timeout here leaves cancelling durable. The pump must retry, rather
    // than expose a terminal state while the container may still be running.
    await worker(`/jobs/${id}/cancel`,'POST',{},45000)
    return prisma.$transaction(async tx=>{
      const current=await lockedRun(tx,id)
      if(!current||current.status!=='cancelling')return false
      if(await tx.prepProposal.count({where:{runId:id,status:'executing'}}))return false
      const status=current.error?'failed':'cancelled'
      await tx.prepRun.update({where:{id},data:{status,finishedAt:new Date()}})
      await tx.prepProposal.updateMany({where:{runId:id,status:'pending'},data:{status:current.error?'expired':'rejected',result:JSON.stringify(current.error?{error:current.error}:{cancelled:true})}})
      await tx.prepEvent.create({data:{sessionId:current.sessionId,runId:id,type:'status',data:JSON.stringify({status,message:current.error||'任务已停止'})}})
      return true
    })
  }
  async function processRun(run:any){
    const controller=new AbortController();controllers.set(run.id,controller)
    const runLock=rk(`prep:run:${run.id}`)
    let lease:ReturnType<typeof setInterval>|undefined
    try{
      if(redis.status!=='ready')throw new Error('备课队列暂不可用，请稍后重试')
      if(await redis.set(runLock,lockOwner,'PX',60000,'NX')!=='OK')return
      lease=setInterval(()=>{void redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],60000) else return 0 end",1,runLock,lockOwner).then(value=>{if(!value)controller.abort()}).catch(()=>controller.abort())},15000)
      const message=await prisma.prepMessage.findUnique({where:{id:run.messageId}})
      if(!message)throw new Error('备课输入不存在')
      const started=await prisma.$transaction(async tx=>{
        const current=await lockedRun(tx,run.id)
        if(!current||!runnableStates.includes(current.status))return null
        return tx.prepRun.update({where:{id:run.id},data:{status:'running',startedAt:current.startedAt||new Date()}})
      })
      if(!started)return
      const deadline=started.startedAt!.getTime()+env.PREP_RUN_TIMEOUT_MINUTES*60000
      if(Date.now()>deadline)throw new Error('本次备课已达到运行时限，请缩小任务后重试')
      await event(run.sessionId,run.id,'status',{status:'running',message:'正在启动备课环境'})
      await worker('/jobs','POST',{id:run.id,sessionId:run.sessionId,ownerId:run.ownerId,content:message.content,attachmentIds:decode(message.attachmentIds,[]),timeoutMinutes:env.PREP_RUN_TIMEOUT_MINUTES})
      let cursor=started.workerCursor,pollFailures=0
      while(!closing&&!controller.signal.aborted){
        const current=await prisma.prepRun.findUnique({where:{id:run.id},select:{status:true}})
        if(!current||!runnableStates.includes(current.status))return
        if(Date.now()>deadline)throw new Error('本次备课已达到运行时限，请缩小任务后重试')
        let state:any
        try{state=await worker(`/jobs/${run.id}/events?after=${cursor}`);pollFailures=0}
        catch(error){
          if(++pollFailures>=3)throw error
          app.log.warn({runId:run.id,attempt:pollFailures},'备课事件同步暂时失败，将重试')
          await sleep(800*pollFailures);continue
        }
        if(state.events?.length){
          for(const item of state.events){
            if(!Number.isSafeInteger(item.id)||item.id<=cursor||!['status','reasoning','text','tool-start','tool-result','error','artifact'].includes(item.type))continue
            await prisma.$transaction(async tx=>{
              await tx.prepEvent.create({data:{sessionId:run.sessionId,runId:run.id,type:item.type,data:JSON.stringify(item.data)}})
              await tx.prepRun.update({where:{id:run.id},data:{workerCursor:item.id}})
            });cursor=item.id
          }
        }
        if(!state.hasMore&&['completed','failed','cancelled'].includes(state.status)){
          const finished=await prisma.$transaction(async tx=>{
            const current=await lockedRun(tx,run.id)
            if(!current||!runnableStates.includes(current.status))return false
            if(await tx.prepProposal.count({where:{runId:run.id,status:'executing'}}))return false
            if(state.status==='completed'&&state.response){
              const exists=await tx.prepMessage.findFirst({where:{runId:run.id,role:'assistant'}})
              if(!exists)await tx.prepMessage.create({data:{sessionId:run.sessionId,runId:run.id,role:'assistant',content:String(state.response).slice(0,200000),attachmentIds:'[]'}})
            }
            await tx.prepRun.update({where:{id:run.id},data:{status:state.status,error:state.error?String(state.error).slice(0,1000):null,finishedAt:new Date()}})
            await tx.prepProposal.updateMany({where:{runId:run.id,status:'pending'},data:{status:'expired'}})
            await tx.prepSession.update({where:{id:run.sessionId},data:{updatedAt:new Date()}})
            await tx.prepEvent.create({data:{sessionId:run.sessionId,runId:run.id,type:'status',data:JSON.stringify({status:state.status,message:state.error||'本次备课已结束'})}})
            return true
          })
          if(finished)return
        }
        await sleep(800)
      }
    }catch(error){
      if(!closing){
        const message=error instanceof Error?error.message:'备课运行失败'
        try{
          const stopping=await requestStop(run.id,message)
          if(stopping?.status==='cancelling')await finishStopping(run.id)
        }catch(stopError){app.log.warn({err:stopError,runId:run.id},'隔离任务尚未确认停止，保留待重试状态')}
      }
    }finally{
      if(lease)clearInterval(lease)
      await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",1,runLock,lockOwner).catch(()=>{})
      controllers.delete(run.id)
    }
  }
  async function pump(){
    if(closing||pumping||!configured())return
    pumping=true
    try{
      const stopping=await prisma.prepRun.findMany({where:{status:'cancelling'},take:10})
      for(const run of stopping){
        if(controllers.has(run.id))continue
        try{await finishStopping(run.id)}catch{}
      }
      const pendingStops=await prisma.prepRun.count({where:{status:'cancelling',id:{notIn:[...controllers.keys()]}}})
      const available=env.PREP_CONCURRENCY-controllers.size-pendingStops
      if(available>0){
        const runs=await prisma.prepRun.findMany({where:{status:{in:runnableStates}},orderBy:{createdAt:'asc'},take:available+controllers.size})
        for(const run of runs){if(!controllers.has(run.id)&&controllers.size<env.PREP_CONCURRENCY-pendingStops)void processRun(run)}
      }
    }catch(error){app.log.error({err:error},'备课队列轮询失败')}finally{pumping=false}
  }
  const timer=setInterval(()=>void pump(),1500);timer.unref()
  app.addHook('onClose',async()=>{closing=true;clearInterval(timer);for(const c of controllers.values())c.abort()})

  app.get('/prep/status',async req=>{
    const me=await requireUser(req)
    let ready=false,message='智能备课尚未启用'
    if(configured()){try{const health=await worker('/health','GET',undefined,5000);ready=!!health.ready;message=health.message||''}catch{message='备课执行环境暂不可用'}}
    return {enabled:ready,userId:me.id,model:'deepseek-flash',message,limits:{maxFileMB:env.PREP_MAX_FILE_MB,maxFileBytes:env.PREP_MAX_FILE_MB*1024*1024,maxAttachments:10,userStorageMB:env.PREP_USER_STORAGE_MB,dailyRuns:env.PREP_DAILY_RUNS,concurrency:env.PREP_CONCURRENCY}}
  })
  app.get('/prep/sessions',async req=>{
    const me=await requireUser(req)
    const sessions=await prisma.prepSession.findMany({where:{ownerId:me.id},orderBy:{updatedAt:'desc'},take:100,select:{id:true,title:true,updatedAt:true,runs:{orderBy:{createdAt:'desc'},take:1,select:{status:true}}}})
    return {sessions:sessions.map(({runs,...session})=>({...session,status:runs[0]?.status||null}))}
  })
  app.post('/prep/sessions',async req=>{
    const me=await requireUser(req);requireConfigured()
    await enforce([{key:`prep:sessions:${me.id}`,limit:30,windowMs:3600000}],'新建备课对话太频繁')
    const body=parseBody(z.object({title:z.string().trim().min(1).max(120).optional()}),req.body||{})
    return {session:await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${me.id} FOR UPDATE`
      if(await tx.prepSession.count({where:{ownerId:me.id}})>=100)throw badRequest('最多保留100个备课对话，请先删除不需要的对话')
      return tx.prepSession.create({data:{ownerId:me.id,...body}})
    })}
  })
  async function view(ownerId:string,id:string,after=0){
    const session=await ownSession(ownerId,id)
    const [messages,events,attachments,proposals,activeRun]=await Promise.all([
      prisma.prepMessage.findMany({where:{sessionId:id},orderBy:{createdAt:'asc'}}),
      prisma.prepEvent.findMany({where:{sessionId:id,id:{gt:after}},orderBy:{id:'asc'},take:500}),
      prisma.prepAttachment.findMany({where:{sessionId:id},orderBy:{createdAt:'asc'}}),
      prisma.prepProposal.findMany({where:{sessionId:id},orderBy:{createdAt:'asc'}}),
      prisma.prepRun.findFirst({where:{sessionId:id},orderBy:{createdAt:'desc'}}),
    ])
    return {session,messages:messages.map(messageDto),events:events.map(eventDto),hasMore:events.length===500,attachments:attachments.map(attachmentDto),proposals:proposals.map(proposalDto),activeRun}
  }
  app.get('/prep/sessions/:id',async req=>{const me=await requireUser(req);return view(me.id,paramId(req))})
  app.get('/prep/sessions/:id/events',async req=>{
    const me=await requireUser(req),after=parseBody(z.coerce.number().int().min(0).default(0),(req.query as any).after)
    return view(me.id,paramId(req),after)
  })
  app.patch('/prep/sessions/:id',async req=>{
    const me=await requireUser(req),id=paramId(req);await ownSession(me.id,id)
    const body=parseBody(z.object({title:z.string().trim().min(1).max(120)}),req.body)
    return {session:await prisma.prepSession.update({where:{id},data:body})}
  })
  app.delete('/prep/sessions/:id',async req=>{
    const me=await requireUser(req),id=paramId(req);await ownSession(me.id,id)
    const files=await prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM prep_sessions WHERE id=${id} AND ownerId=${me.id} FOR UPDATE`
      if(!rows.length)throw notFound('对话已删除')
      if(await tx.prepRun.count({where:{sessionId:id,status:{in:activeStates}}}))throw conflict('请先停止正在进行的任务，再删除对话')
      if(await tx.prepProposal.count({where:{sessionId:id,status:'executing'}}))throw conflict('已确认的班级或作业操作正在执行，请等待完成后再删除对话')
      const files=await tx.prepAttachment.findMany({where:{sessionId:id},select:{storageKey:true}})
      // The row lock also excludes concurrent message creation and attachment reservation.
      if(configured())await worker(`/sessions/${id}`,'DELETE',{ownerId:me.id})
      await tx.prepSession.delete({where:{id}});return files
    },{timeout:30000,maxWait:15000})
    await Promise.all(files.map(f=>removeAttachment(f.storageKey)))
    return {ok:true}
  })
  app.post('/prep/sessions/:id/messages',async req=>{
    const me=await requireUser(req),id=paramId(req);requireConfigured();await ownSession(me.id,id)
    const body=parseBody(z.object({content:z.string().trim().max(20000).default(''),attachmentIds:z.array(idField).max(10).default([])}),req.body)
    if(!body.content&&!body.attachmentIds.length)throw badRequest('请输入内容或添加附件')
    const files=await prisma.prepAttachment.findMany({where:{id:{in:body.attachmentIds},sessionId:id,ownerId:me.id}})
    if(files.length!==new Set(body.attachmentIds).size)throw badRequest('附件不属于当前对话')
    const day=new Date(Date.now()+8*3600000);day.setUTCHours(0,0,0,0);day.setTime(day.getTime()-8*3600000)
    const result=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${me.id} FOR UPDATE`
      await tx.$executeRaw`INSERT IGNORE INTO prep_storage_lock (id) VALUES (1)`
      await tx.$queryRaw`SELECT id FROM prep_storage_lock WHERE id=1 FOR UPDATE`
      const sessions=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM prep_sessions WHERE id=${id} AND ownerId=${me.id} FOR UPDATE`
      if(!sessions.length)throw notFound('对话已删除')
      if(await tx.prepRun.count({where:{ownerId:me.id,status:{in:activeStates}}}))throw conflict('请等待当前备课完成，或先停止任务')
      const pending=await tx.prepRun.count({where:{status:{in:activeStates}}})
      if(pending>=env.PREP_MAX_QUEUED_RUNS)throw new ApiError('RATE_LIMITED','备课队列已满，请稍后再试')
      const [events,messages]=await Promise.all([
        tx.$queryRaw<Array<{total:unknown,personal:unknown}>>`SELECT COALESCE(SUM(OCTET_LENGTH(e.data)),0) total,COALESCE(SUM(IF(s.ownerId=${me.id},OCTET_LENGTH(e.data),0)),0) personal FROM prep_events e JOIN prep_sessions s ON s.id=e.sessionId`,
        tx.$queryRaw<Array<{total:unknown,personal:unknown}>>`SELECT COALESCE(SUM(OCTET_LENGTH(m.content)),0) total,COALESCE(SUM(IF(s.ownerId=${me.id},OCTET_LENGTH(m.content),0)),0) personal FROM prep_messages m JOIN prep_sessions s ON s.id=m.sessionId`,
      ])
      const reserve=9*1024*1024 // Worker trace <=8 MiB plus bounded user/final messages.
      if(Number(events[0]?.personal)+Number(messages[0]?.personal)+reserve>env.PREP_USER_HISTORY_MB*1024*1024)throw badRequest('个人备课记录空间已满，请先删除不需要的对话')
      if(Number(events[0]?.total)+Number(messages[0]?.total)+(pending+1)*reserve>env.PREP_GLOBAL_HISTORY_MB*1024*1024)throw badRequest('备课记录总空间已满，请联系管理员清理或调整额度')
      if(await tx.prepRun.count({where:{ownerId:me.id,createdAt:{gte:day}}})>=env.PREP_DAILY_RUNS)throw new ApiError('RATE_LIMITED','今日备课次数已用完')
      const message=await tx.prepMessage.create({data:{sessionId:id,role:'user',content:body.content,attachmentIds:JSON.stringify(body.attachmentIds)}})
      const run=await tx.prepRun.create({data:{sessionId:id,ownerId:me.id,messageId:message.id}})
      await tx.prepMessage.update({where:{id:message.id},data:{runId:run.id}})
      await tx.prepSession.update({where:{id},data:{updatedAt:new Date(),...(await tx.prepMessage.count({where:{sessionId:id,role:'user'}})===1&&body.content?{title:body.content.slice(0,60)}:{})}})
      return run
    },{timeout:30000,maxWait:20000})
    await event(id,result.id,'status',{status:'queued',message:'任务已进入备课队列，关闭页面仍会继续'})
    void pump();return {runId:result.id,status:result.status}
  })
  app.post('/prep/sessions/:id/cancel',async req=>{
    const me=await requireUser(req),id=paramId(req);await ownSession(me.id,id)
    const body=parseBody(z.object({runId:idField}),req.body)
    const run=await prisma.prepRun.findFirst({where:{id:body.runId,sessionId:id}})
    if(!run)throw notFound('任务不存在')
    // The same run lock linearizes this boundary with proposal confirmation.
    const stopping=await requestStop(body.runId,undefined,true)
    if(!stopping||stopping.status!=='cancelling')return {ok:true,status:stopping?.status||run.status}
    controllers.get(body.runId)?.abort()
    try{await finishStopping(body.runId)}catch(error){
      app.log.warn({err:error,runId:body.runId},'用户请求停止的隔离任务尚未确认结束')
      throw conflict('已请求停止，但执行环境尚未确认结束；系统会继续重试，请稍后查看')
    }
    const current=await prisma.prepRun.findUnique({where:{id:body.runId},select:{status:true}})
    if(current?.status==='cancelling')throw conflict('已确认的操作仍在执行，系统正在等待其完成；请稍后查看')
    return {ok:true,status:current?.status||'cancelled'}
  })
  app.post('/prep/sessions/:id/attachments',{bodyLimit:env.PREP_MAX_FILE_MB*1024*1024},async req=>{
    const me=await requireUser(req),id=paramId(req);requireConfigured();await ownSession(me.id,id)
    await enforce([{key:`prep:upload:${me.id}`,limit:60,windowMs:3600000}],'文件上传太频繁')
    const name=parseBody(z.string().min(1).max(220),(req.query as any).filename)
    if(!Buffer.isBuffer(req.body))throw badRequest('请使用原始文件上传')
    return {attachment:attachmentDto(await storeAttachment(me.id,id,name,req.body,'upload'))}
  })
  app.get('/prep/attachments/:id',async(req,reply)=>{
    const me=await requireUser(req),file=await prisma.prepAttachment.findFirst({where:{id:paramId(req),ownerId:me.id}})
    if(!file)throw notFound('文件不存在')
    return reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff').header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).type(file.mime).send(await readAttachment(file.storageKey))
  })
  app.get('/prep/skills',async req=>{const me=await requireUser(req);return {skills:await prisma.prepSkill.findMany({where:{ownerId:me.id},orderBy:{createdAt:'asc'}})}})
  app.post('/prep/skills',async req=>{
    const me=await requireUser(req);requireConfigured()
    const body=parseBody(z.object({name:z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}_ -]+$/u),content:z.string().min(1).max(30000)}),req.body)
    return {skill:await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${me.id} FOR UPDATE`
      const existing=await tx.prepSkill.findUnique({where:{ownerId_name:{ownerId:me.id,name:body.name}}})
      if(!existing&&await tx.prepSkill.count({where:{ownerId:me.id}})>=20)throw badRequest('最多保留20个自定义Skill')
      return tx.prepSkill.upsert({where:{ownerId_name:{ownerId:me.id,name:body.name}},create:{ownerId:me.id,...body},update:{content:body.content}})
    })}
  })
  app.delete('/prep/skills/:id',async req=>{const me=await requireUser(req);await prisma.prepSkill.deleteMany({where:{id:paramId(req),ownerId:me.id}});return {ok:true}})

  async function ownedProposal(req:FastifyRequest){
    const me=await requireUser(req),p=await prisma.prepProposal.findFirst({where:{id:paramId(req),ownerId:me.id}})
    if(!p)throw notFound('预览不存在')
    if(p.status!=='pending')throw conflict('这份预览已经处理，请刷新状态')
    if(p.expiresAt.getTime()<Date.now())throw conflict('预览已过期，请让助手重新生成')
    const run=await prisma.prepRun.findUnique({where:{id:p.runId},select:{status:true}})
    if(!run||!runnableStates.includes(run.status))throw conflict('这次备课已结束，请在对话中重新发起操作')
    return p
  }
  app.patch('/prep/proposals/:id',async req=>{
    const p=await ownedProposal(req),body=parseBody(z.object({payload:z.record(z.string(),z.unknown()),version:z.string()}),req.body)
    const parsed=parseTeaching(p.tool,body.payload),preview=await previewTeaching(app,p.ownerId,parsed.tool,parsed.payload),version=proposalVersion(parsed.tool,{payload:parsed.payload,preview})
    const changed=await prisma.prepProposal.updateMany({where:{id:p.id,status:'pending',version:body.version},data:{payload:JSON.stringify(parsed.payload),preview:JSON.stringify(preview),version}})
    if(!changed.count)throw conflict('预览已变化，请重新查看再确认')
    return {proposal:proposalDto(await prisma.prepProposal.findUniqueOrThrow({where:{id:p.id}}))}
  })
  app.post('/prep/proposals/:id/reject',async req=>{const p=await ownedProposal(req);await prisma.prepProposal.updateMany({where:{id:p.id,status:'pending'},data:{status:'rejected',result:JSON.stringify({rejected:true})}});await event(p.sessionId,p.runId,'proposal',{id:p.id,status:'rejected'});return {ok:true}})
  app.post('/prep/proposals/:id/confirm',async req=>{
    const p=await ownedProposal(req),body=parseBody(z.object({version:z.string()}),req.body)
    if(body.version!==p.version)throw conflict('预览已变化，请重新加载并核对')
    const parsed=parseTeaching(p.tool,decode(p.payload)),preview=await previewTeaching(app,p.ownerId,parsed.tool,parsed.payload)
    if(JSON.stringify(preview)!==p.preview){
      await prisma.prepProposal.updateMany({where:{id:p.id,status:'pending',version:p.version},data:{preview:JSON.stringify(preview),version:proposalVersion(p.tool,{payload:parsed.payload,preview})}})
      throw conflict('班级或作业资料已有变化，请重新核对更新后的预览')
    }
    // Claim once before the write. A lost connection never silently replays a business mutation.
    await prisma.$transaction(async tx=>{
      const run=await lockedRun(tx,p.runId)
      if(!run||!runnableStates.includes(run.status))throw conflict('这次备课正在停止或已经结束，未执行这项操作')
      const claimed=await tx.prepProposal.updateMany({where:{id:p.id,status:'pending',version:body.version,expiresAt:{gte:new Date()}},data:{status:'executing'}})
      if(!claimed.count)throw conflict('预览已变化、过期或正在执行，请重新加载')
    })
    try{
      const result=await executeTeaching(app,p.ownerId,parsed.tool,parsed.payload)
      await prisma.prepProposal.update({where:{id:p.id},data:{status:'applied',result:JSON.stringify(result)}})
      await event(p.sessionId,p.runId,'proposal',{id:p.id,status:'applied',result});return {ok:true,result}
    }catch(error){
      const message=error instanceof Error?error.message:'执行失败'
      await prisma.prepProposal.update({where:{id:p.id},data:{status:'rejected',result:JSON.stringify({error:message})}})
      throw error
    }
  })

  // The remote broker holds this credential; execution containers only get per-job capabilities.
  app.post('/prep/internal/runs/:runId/tool',async req=>{
    workerAuth(req);const runId=paramId(req,'runId'),run=await prisma.prepRun.findUnique({where:{id:runId}})
    if(!run||!runnableStates.includes(run.status))throw notFound('任务不存在或已停止')
    const body=parseBody(z.object({tool:z.string(),payload:z.unknown(),callId:z.string().min(1).max(160)}),req.body),parsed=parseTeaching(body.tool,body.payload)
    if(isTeachingRead(parsed.tool))return {result:await executeTeaching(app,run.ownerId,parsed.tool,parsed.payload)}
    const preview=await previewTeaching(app,run.ownerId,parsed.tool,parsed.payload)
    const p=await prisma.$transaction(async tx=>{
      const current=await lockedRun(tx,runId)
      if(!current||!runnableStates.includes(current.status))throw notFound('任务不存在或已停止')
      const proposal=await tx.prepProposal.upsert({where:{runId_callId:{runId,callId:body.callId}},update:{},create:{ownerId:run.ownerId,sessionId:run.sessionId,runId,callId:body.callId,tool:parsed.tool,description:String(preview.description||parsed.tool),payload:JSON.stringify(parsed.payload),preview:JSON.stringify(preview),version:proposalVersion(parsed.tool,{payload:parsed.payload,preview}),expiresAt:new Date(Date.now()+20*60000)}})
      await tx.prepRun.update({where:{id:runId},data:{status:'waiting'}})
      await tx.prepEvent.create({data:{sessionId:run.sessionId,runId,type:'proposal',data:JSON.stringify(proposalDto(proposal))}})
      await tx.prepEvent.create({data:{sessionId:run.sessionId,runId,type:'status',data:JSON.stringify({status:'waiting',message:'等待教师检查并确认预览'})}})
      return proposal
    })
    return {proposal:proposalDto(p)}
  })
  app.get('/prep/internal/runs/:runId/proposals/:proposalId',async req=>{
    workerAuth(req);const runId=paramId(req,'runId'),p=await prisma.prepProposal.findFirst({where:{id:paramId(req,'proposalId'),runId}})
    if(!p)throw notFound()
    if(p.status==='pending'&&p.expiresAt.getTime()<Date.now()){await prisma.prepProposal.updateMany({where:{id:p.id,status:'pending'},data:{status:'expired'}});return {status:'expired'}}
    if(['applied','rejected','expired'].includes(p.status))await prisma.prepRun.updateMany({where:{id:runId,status:'waiting'},data:{status:'running'}})
    return {status:p.status,result:decode(p.result,null),payload:decode(p.payload),version:p.version}
  })
  app.get('/prep/internal/runs/:runId/input',async req=>{
    workerAuth(req);const run=await prisma.prepRun.findUnique({where:{id:paramId(req,'runId')}})
    if(!run||!activeStates.includes(run.status))throw notFound()
    const [skills,messages]=await Promise.all([
      prisma.prepSkill.findMany({where:{ownerId:run.ownerId}}),
      prisma.prepMessage.findMany({where:{sessionId:run.sessionId},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,role:true,content:true,attachmentIds:true}}),
    ])
    const boundary=messages.findIndex(message=>message.id===run.messageId&&message.role==='user')
    if(boundary<0)throw notFound('本次备课输入不存在')
    // Uploading is only staging. Files removed from the composer, and future
    // messages, must never silently enter this run's model context.
    const admitted=messages.slice(0,boundary+1)
    const ids=[...new Set(admitted.filter(message=>message.role==='user').flatMap(message=>{
      const value=decode(message.attachmentIds,[])
      return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[]
    }))]
    const files=await prisma.prepAttachment.findMany({where:{id:{in:ids},sessionId:run.sessionId,ownerId:run.ownerId,kind:'upload'},orderBy:{createdAt:'asc'}})
    return {files:files.map(attachmentDto),skills:skills.map(s=>({id:s.id,name:s.name,content:s.content})),history:admitted.map(({attachmentIds:_,...message})=>message)}
  })
  app.get('/prep/internal/runs/:runId/attachments/:attachmentId',async(req,reply)=>{
    workerAuth(req);const run=await prisma.prepRun.findUnique({where:{id:paramId(req,'runId')}})
    if(!run||!activeStates.includes(run.status))throw notFound()
    const file=await prisma.prepAttachment.findFirst({where:{id:paramId(req,'attachmentId'),sessionId:run.sessionId}})
    if(!file)throw notFound()
    return reply.header('cache-control','no-store').type('application/octet-stream').send(await readAttachment(file.storageKey))
  })
  app.post('/prep/internal/runs/:runId/artifacts',{bodyLimit:env.PREP_MAX_FILE_MB*1024*1024},async req=>{
    workerAuth(req);const run=await prisma.prepRun.findUnique({where:{id:paramId(req,'runId')}})
    if(!run||!activeStates.includes(run.status))throw notFound()
    if(!Buffer.isBuffer(req.body))throw badRequest('文件内容不正确')
    const file=await storeAttachment(run.ownerId,run.sessionId,parseBody(z.string().min(1).max(220),(req.query as any).filename),req.body,'artifact')
    await event(run.sessionId,run.id,'artifact',attachmentDto(file));return {attachment:attachmentDto(file)}
  })
  app.post('/prep/internal/runs/:runId/image',async req=>{
    workerAuth(req);const run=await prisma.prepRun.findUnique({where:{id:paramId(req,'runId')}})
    if(!run||!runnableStates.includes(run.status))throw notFound()
    const body=parseBody(z.object({prompt:z.string().trim().min(1).max(800)}),req.body)
    await enforce([{key:`prep:image:${run.id}`,limit:4,windowMs:3600000}],'每次备课最多生成4张配图')
    const bytes=await generateTeachingImage(app,run.ownerId,body.prompt)
    const file=await storeAttachment(run.ownerId,run.sessionId,'备课配图-'+Date.now()+'.png',bytes,'artifact')
    await event(run.sessionId,run.id,'artifact',attachmentDto(file));return {attachment:attachmentDto(file)}
  })
}
