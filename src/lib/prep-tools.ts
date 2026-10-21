import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { signSession } from './auth.js'
import { env } from '../env.js'
import { badRequest, notFound } from './errors.js'
import { memberInputSchema, rosterOperationSchema, assertRoster, planRosterOperations, assertGroupPartition, type RosterMember } from './teaching-roster.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)
const member = z.object({
  name: z.string().trim().min(1).max(30),
  studentNo: z.string().trim().max(40).nullish(),
  gender: z.string().trim().max(20).nullish(),
  score: z.number().min(0).max(100000).nullish(),
})
const question = z.object({
  id, type: z.enum(['single', 'boolean']), stem: z.string().trim().min(1).max(4000),
  options: z.array(z.string().trim().min(1).max(1000)).min(2).max(8),
  answer: z.number().int().min(0).max(7), points: z.number().int().min(1).max(100),
  explanation: z.string().max(4000).default(''),
}).superRefine((v, ctx) => {
  if (v.answer >= v.options.length) ctx.addIssue({code:'custom',message:'正确答案超出选项范围'})
  if (v.type === 'boolean' && (v.options.length !== 2 || v.options[0] !== '正确' || v.options[1] !== '错误')) ctx.addIssue({code:'custom',message:'判断题选项必须是正确、错误'})
})
const quiz = z.object({ questions: z.array(question).min(1).max(100) }).superRefine((v, ctx) => {
  if (new Set(v.questions.map(q => q.id)).size !== v.questions.length) ctx.addIssue({code:'custom',message:'题目编号重复'})
})

export const teachingSchemas = {
  list_classrooms: z.object({}),
  get_classroom: z.object({classId:id}),
  get_assignment: z.object({classId:id,assignmentId:id}),
  create_classroom: z.object({name:z.string().trim().min(1).max(60),members:z.array(member).max(100).default([])}),
  edit_class_roster: z.object({classId:id,operations:z.array(z.object({
    action:z.enum(['add','update','delete']),id:id.optional(),name:z.string().trim().min(1).max(30).optional(),
    studentNo:z.string().trim().max(60).nullish(),gender:z.string().trim().max(20).nullish(),score:z.number().min(0).max(100000).nullish(),
  }).superRefine((v,ctx)=>{
    if(v.action !== 'add' && !v.id) ctx.addIssue({code:'custom',message:'修改和删除必须指定成员编号'})
    if(v.action === 'add' && !v.name) ctx.addIssue({code:'custom',message:'新增成员必须有姓名'})
  })).min(1).max(200)}),
  save_groups:z.object({classId:id,groups:z.array(z.object({name:z.string().trim().min(1).max(60),memberIds:z.array(id).min(1).max(100)})).min(1).max(100)}),
  create_assignment:z.object({classId:id,title:z.string().trim().min(1).max(120),type:z.enum(['storybook','lab','task','quiz']),instructions:z.string().max(1000).default(''),
    status:z.enum(['draft','open']).default('draft'),labId:z.string().max(40).optional(),moduleId:z.string().max(8).optional(),stage:z.string().max(8).optional(),activity:z.string().max(120).optional(),toolLabId:z.string().max(40).nullish(),quiz:quiz.optional(),
  }).superRefine((v,ctx)=>{
    if(v.type==='quiz' && !v.quiz) ctx.addIssue({code:'custom',message:'试卷缺少题目'})
    if(v.type==='lab' && !v.labId) ctx.addIssue({code:'custom',message:'互动练习缺少labId'})
    if(v.type==='task' && (!v.moduleId || !v.stage || !v.activity)) ctx.addIssue({code:'custom',message:'课程任务定位不完整'})
  }),
  publish_assignment:z.object({classId:id,assignmentId:id,status:z.enum(['open','closed']).default('open')}),
  publish_quiz_results:z.object({classId:id,assignmentId:id,scoresPublished:z.boolean().optional(),answersPublished:z.boolean().optional()})
    .refine(v=>v.scoresPublished!==undefined || v.answersPublished!==undefined,'请选择公布成绩或答案'),
}
export type TeachingTool = keyof typeof teachingSchemas
const readTools = new Set<TeachingTool>(['list_classrooms','get_classroom','get_assignment'])
export const isTeachingRead = (tool: TeachingTool) => readTools.has(tool)
export const proposalVersion = (tool:string,payload:unknown) => createHash('sha256').update(JSON.stringify({tool,payload})).digest('hex')

export function parseTeaching(tool: string, payload: unknown): {tool:TeachingTool,payload:Record<string,unknown>} {
  if (!Object.hasOwn(teachingSchemas, tool)) throw badRequest('不支持的教学工具')
  const result = teachingSchemas[tool as TeachingTool].safeParse(payload)
  if (!result.success) throw badRequest(result.error.issues[0]?.message || '教学工具参数不正确')
  return {tool:tool as TeachingTool,payload:result.data as Record<string,unknown>}
}

/** JWT only exists in this trusted process; the model and execution container never receive it. */
async function request(app:FastifyInstance, ownerId:string, method:'GET'|'POST'|'PUT'|'PATCH', url:string, payload?:Record<string,unknown>):Promise<Record<string,any>> {
  const user = await prisma.user.findUnique({where:{id:ownerId},select:{sessionVersion:true}})
  if (!user) throw notFound('账号不存在')
  const cookie = `${env.COOKIE_NAME}=${await signSession(ownerId,user.sessionVersion)}`
  const result = await app.inject({method,url,headers:{cookie},...(payload ? {payload} : {})})
  const data = result.json()
  if (result.statusCode >= 400) throw badRequest(data.error?.message || '教学工具执行失败')
  return data
}

export async function generateTeachingImage(app:FastifyInstance,ownerId:string,prompt:string):Promise<Buffer>{
  const result=await request(app,ownerId,'POST','/api/ai/image',{prompt,n:1})
  const image=result.images?.find((v:unknown)=>typeof v==='string')
  if(typeof image!=='string')throw badRequest('配图服务没有返回图片')
  const limit=env.PREP_MAX_FILE_MB*1024*1024
  if(image.startsWith('data:image/')){
    const encoded=image.split(',')[1]||''
    if(encoded.length>limit*1.4)throw badRequest('生成图片过大')
    return Buffer.from(encoded,'base64')
  }
  if(!image.startsWith('https://'))throw badRequest('配图地址无效')
  // The URL originates in the existing trusted image provider, never in model arguments.
  const response=await fetch(image,{signal:AbortSignal.timeout(45000)})
  if(!response.ok||!response.body)throw badRequest('配图下载失败')
  const chunks:Buffer[]=[];let size=0
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw badRequest('生成图片过大');chunks.push(Buffer.from(chunk))}
  return Buffer.concat(chunks)
}

export async function executeTeaching(app:FastifyInstance,ownerId:string,tool:TeachingTool,p:Record<string,unknown>) {
  const cls = `/api/classes/${p.classId}`
  switch(tool) {
    case 'list_classrooms': return request(app,ownerId,'GET','/api/classes')
    case 'get_classroom': return request(app,ownerId,'GET',cls)
    case 'get_assignment': return request(app,ownerId,'GET',`${cls}/assignments/${p.assignmentId}`)
    case 'create_classroom': return request(app,ownerId,'POST','/api/classes',p)
    case 'edit_class_roster': return request(app,ownerId,'POST',`${cls}/members/batch`,{operations:p.operations})
    case 'save_groups': return request(app,ownerId,'PUT',`${cls}/groups`,{groups:p.groups})
    case 'create_assignment': { const {classId:_,...body}=p; return request(app,ownerId,'POST',`${cls}/assignments`,body) }
    case 'publish_assignment': return request(app,ownerId,'PATCH',`${cls}/assignments/${p.assignmentId}`,{status:p.status})
    case 'publish_quiz_results': {const {classId:_,assignmentId:__,...body}=p;return request(app,ownerId,'PATCH',`${cls}/assignments/${p.assignmentId}`,body)}
  }
}

export async function previewTeaching(app:FastifyInstance,ownerId:string,tool:TeachingTool,p:Record<string,unknown>) {
  if (isTeachingRead(tool)) return executeTeaching(app,ownerId,tool,p)
  const before = p.classId ? await request(app,ownerId,'GET',`/api/classes/${p.classId}`) : null
  const assignment=p.assignmentId ? await request(app,ownerId,'GET',`/api/classes/${p.classId}/assignments/${p.assignmentId}`) : null
  const members = (before?.classroom?.members || before?.class?.members || before?.members || []) as Array<{id:string,name:string,studentNo?:string}>
  if (tool==='save_groups') {
    const ids = (p.groups as Array<{memberIds:string[]}>).flatMap(g=>g.memberIds)
    if (ids.length!==members.length || new Set(ids).size!==ids.length || ids.some(i=>!members.some(m=>m.id===i))) throw badRequest('分组须覆盖全部班级成员且每人只出现一次')
    assertGroupPartition(members.map(m=>m.id),p.groups as Array<{name:string,memberIds:string[]}>)
  }
  if(tool==='create_classroom')assertRoster((p.members as unknown[]).map(m=>memberInputSchema.parse(m)))
  if (tool==='edit_class_roster') {
    planRosterOperations(members as RosterMember[],(p.operations as unknown[]).map(op=>rosterOperationSchema.parse(op)))
    for (const op of p.operations as Array<{id?:string,action:string}>) {
      if(op.action!=='add' && !members.some(m=>m.id===op.id)) throw badRequest('名单操作含不属于该班级的成员')
    }
  }
  return {description:({create_classroom:'创建班级与名单',edit_class_roster:'变更班级名单',save_groups:'保存班级分组',create_assignment:'创建作业',publish_assignment:'变更作业开放状态',publish_quiz_results:'公布或隐藏试卷成绩与答案'} as Partial<Record<TeachingTool,string>>)[tool],before,assignment,changes:p,
    notes:tool==='edit_class_roster' ? ['删除成员可能影响已有提交；已发布展厅作品的删除保护仍生效。'] : []}
}
