/** Run on the configured API host: node --import tsx scripts/teaching-api-e2e.mjs
 * Uses two synthetic DB fixtures, no mail/images/model calls; cleans only its own IDs.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { prisma } from '../src/lib/db.ts'
import { signSession } from '../src/lib/auth.ts'
import { env } from '../src/env.ts'

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('本套件只能对本机配置的 API 运行')
const marker = '教学工具验收-' + randomBytes(5).toString('hex')
const created = []
let passed = 0
function check(name, condition) { assert.ok(condition,name);passed++;console.log('PASS '+name) }
function client(cookie='') {
  let jar=cookie
  return { async call(path,method='GET',body) {
    const res=await fetch(base+'/api'+path,{method,headers:{...(jar?{cookie:jar}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined})
    for (const line of res.headers.getSetCookie()) {
      const match=line.match(/^aiq_assign=([^;]*)/)
      if(match) jar=match[1]?'aiq_assign='+match[1]:''
    }
    const json=await res.json()
    return {status:res.status,json}
  }}
}
async function teacher(suffix) {
  const user=await prisma.user.create({data:{email:`${marker}-${suffix}@example.invalid`,nickname:marker,passwordHash:'not-a-login-hash'}})
  created.push(user.id)
  return client(`${env.COOKIE_NAME}=${await signSession(user.id,user.sessionVersion)}`)
}
const questions=[
  {id:'input',type:'single',stem:'以下哪项用于输入？',options:['显示器','键盘'],answer:1,points:3,explanation:'键盘将输入传给设备。'},
  {id:'data',type:'boolean',stem:'计算机能够处理数据。',options:['正确','错误'],answer:0,points:7,explanation:'计算机处理输入的数据。'},
]
try {
  const a=await teacher('a'), b=await teacher('b')
  let r=await a.call('/classes','POST',{name:marker,members:[{name:'同名学生',studentNo:'001',gender:'女',score:95},{name:'同名学生',studentNo:'002'}]})
  check('创建班级与可选名单原子保存',r.status===200 && r.json.class.members.length===2)
  const classId=r.json.class.id
  const [first,second]=r.json.class.members
  check('学号保留前导零且缺失字段保持空值',first.studentNo==='001' && second.gender===null && second.score===null)
  r=await a.call('/classes','POST',{name:marker+'-bad',members:[{name:'重复'},{name:'重复'}]})
  check('含模糊同名的整班创建被拒绝',r.status===400)
  const list=await a.call('/classes')
  check('失败创建没有留下空班',list.json.classes.length===1)
  const foreign=await b.call('/classes','POST',{name:marker+'-b',members:[{name:'外班学生'}]})
  const foreignId=foreign.json.class.members[0].id
  r=await b.call('/classes/'+classId)
  check('另一教师不能读取班级',r.status===404 || r.status===403)
  r=await a.call(`/classes/${classId}/members/batch`,'POST',{operations:[{action:'update',id:first.id,score:88},{action:'add',name:'新增学生'}]})
  check('批量更新与新增成功',r.status===200 && r.json.updated===1 && r.json.added===1)
  const third=r.json.members.find(m=>m.name==='新增学生')
  r=await a.call(`/classes/${classId}/members/batch`,'POST',{operations:[{action:'delete',id:third.id},{action:'add',name:'错误学号',studentNo:'001'}]})
  check('批量中的冲突使整批失败',r.status===400)
  let detail=await a.call('/classes/'+classId)
  check('失败批量没有删除原学生',detail.json.class.members.some(m=>m.id===third.id))
  r=await a.call(`/classes/${classId}/members/batch`,'POST',{operations:[{action:'update',id:foreignId,name:'不应修改'}]})
  check('批量编辑拒绝外班成员编号',r.status===400)
  r=await a.call(`/classes/${classId}/groups`,'PUT',{groups:[{name:'第一组',memberIds:[first.id,second.id]},{name:'第二组',memberIds:[third.id]}]})
  check('分组保存本班每位成员一次',r.status===200 && r.json.groups.flatMap(g=>g.members).length===3)
  r=await a.call(`/classes/${classId}/groups`,'PUT',{groups:[{name:'越班组',memberIds:[foreignId]}]})
  check('分组拒绝跨班成员且保留原分组',r.status===400 && (await a.call(`/classes/${classId}/groups`)).json.groups.length===2)
  r=await b.call(`/classes/${classId}/groups`,'PUT',{groups:[]})
  check('其他教师不能改写分组',r.status===403 || r.status===404)

  const instructions='请独立完成全部题目，只能提交一次；成绩和答案由教师公布。'
  r=await a.call(`/classes/${classId}/assignments`,'POST',{title:'单选判断验收',instructions,type:'quiz',status:'draft',quiz:{questions}})
  check('创建试卷草稿',r.status===200 && r.json.assignment.status==='draft')
  const assignment=r.json.assignment, path=`/classes/${classId}/assignments/${assignment.id}`
  const student=client(), publicReader=client()
  r=await publicReader.call('/assign/'+assignment.token)
  check('未发布草稿不向公开链接下发题目',r.status===200 && !r.json.assignment.quiz)
  r=await student.call(`/assign/${assignment.token}/verify`,'POST',{name:'同名学生',studentNo:'001'})
  check('学生不能进入草稿',r.status===403)
  const editedQuestions=questions.map(q=>({...q,stem:q.stem+'（草稿已校对）'}))
  r=await a.call(path,'PATCH',{quiz:{questions:editedQuestions}})
  check('单独编辑草稿题目保留作业说明和草稿状态',r.status===200 && r.json.assignment.status==='draft' && r.json.assignment.instructions===instructions)
  r=await a.call(path,'PATCH',{status:'open'})
  check('单独发布作业不清空说明或覆盖题目与反馈设置',r.status===200 && r.json.assignment.status==='open' && r.json.assignment.instructions===instructions && r.json.assignment.title===assignment.title && isDeepStrictEqual(r.json.assignment.quiz.questions,editedQuestions) && r.json.assignment.scoresPublished===false && r.json.assignment.answersPublished===false)
  r=await a.call(path,'PATCH',{quiz:{questions}})
  check('发布后禁止修改题目',r.status===403)
  r=await publicReader.call('/assign/'+assignment.token)
  check('公开题面始终不含正确答案解析',r.status===200 && r.json.assignment.quiz.questions.every(q=>!('answer' in q) && !('explanation' in q)))
  r=await student.call(`/assign/${assignment.token}/verify`,'POST',{name:'同名学生'})
  check('同名学生必须提供学号',r.status===403)
  r=await student.call(`/assign/${assignment.token}/verify`,'POST',{name:'同名学生',studentNo:'001'})
  check('正确学号核名绑定正确学生',r.status===200 && r.json.member.id===first.id)
  r=await student.call(`/assign/${assignment.token}/submit`,'POST',{kind:'quiz',answers:[{questionId:'input',answer:0}]})
  check('缺答提交被拒绝，保留可提交状态',r.status===400)
  const submit={kind:'quiz',score:999,answers:[{questionId:'input',answer:0},{questionId:'data',answer:0}]}
  const concurrent=await Promise.all([student.call(`/assign/${assignment.token}/submit`,'POST',submit),student.call(`/assign/${assignment.token}/submit`,'POST',submit)])
  check('并发提交只允许一份成功',concurrent.filter(v=>v.status===200).length===1 && concurrent.some(v=>v.status===403))
  check('提交成功只显示已提交，不返回得分',!('score' in concurrent.find(v=>v.status===200).json.submission))
  const stored=await prisma.submission.findUnique({where:{assignmentId_memberId:{assignmentId:assignment.id,memberId:first.id}}})
  check('计分由服务端计算而非客户端score',stored.score===7 && stored.status==='submitted')
  r=await student.call(`/assign/${assignment.token}/session`)
  check('未公布时刷新同样不能取得成绩和标准答案',!('score' in r.json.submission) && r.json.submission.quiz.questions.every(q=>!('answer' in q)))
  r=await a.call(path)
  check('教师能够查看服务端成绩',r.json.members.find(m=>m.id===first.id).score===7)
  r=await a.call(path,'PATCH',{scoresPublished:true})
  check('单独公布成绩保留说明题目和原开放状态',r.status===200 && r.json.assignment.instructions===instructions && r.json.assignment.status==='open' && r.json.assignment.scoresPublished===true && r.json.assignment.answersPublished===false && isDeepStrictEqual(r.json.assignment.quiz.questions,editedQuestions))
  r=await student.call(`/assign/${assignment.token}/me`)
  check('只公布成绩时答案仍隐藏',r.json.submission.score===7 && r.json.submission.quiz.questions.every(q=>!('answer' in q)))
  r=await a.call(path,'PATCH',{answersPublished:true})
  check('单独公布答案保留说明及已公布成绩设置',r.status===200 && r.json.assignment.instructions===instructions && r.json.assignment.status==='open' && r.json.assignment.scoresPublished===true && r.json.assignment.answersPublished===true)
  r=await a.call(path,'PATCH',{status:'closed'})
  check('单独关闭作业保留说明题目和两种反馈公布状态',r.status===200 && r.json.assignment.instructions===instructions && r.json.assignment.title===assignment.title && r.json.assignment.scoresPublished===true && r.json.assignment.answersPublished===true && isDeepStrictEqual(r.json.assignment.quiz.questions,editedQuestions))
  r=await student.call(`/assign/${assignment.token}/me`)
  check('教师公布后显示答案解析',r.json.submission.quiz.questions[0].answer===1 && !!r.json.submission.quiz.questions[0].explanation)
  const returning=client()
  r=await returning.call(`/assign/${assignment.token}/verify`,'POST',{name:'同名学生',studentNo:'001'})
  check('已交卷学生关闭后可重新核名查看公布结果',r.status===200 && r.json.submission.score===7)
  r=await client().call(`/assign/${assignment.token}/verify`,'POST',{name:'同名学生',studentNo:'002'})
  check('未交卷学生不能开始已关闭试卷',r.status===403)
  r=await a.call(path+`/submissions/${stored.id}/reset`,'POST',{})
  check('教师重置接口也不能绕过试卷只交一次',r.status===403)
  r=await a.call(path+`/submissions/${stored.id}/publish`,'POST',{})
  check('试卷不可发布到公开展厅',r.status===403)

  // Existing manual names and old task creation remain available.
  r=await a.call(`/classes/${classId}/members`,'POST',{names:['新增学生','旧导入学生']})
  check('旧names导入兼容并明确返回跳过数量',r.status===200 && r.json.added===1 && r.json.skipped===1)
  r=await a.call(`/classes/${classId}/assignments`,'POST',{title:'旧课程任务',type:'task',moduleId:'m1',stage:'low',activity:'认识身边的人工智能'})
  check('原课程任务创建仍默认开放且缺省说明为空',r.status===200 && r.json.assignment.status==='open' && r.json.assignment.instructions==='')
  const legacyPath=`/classes/${classId}/assignments/${r.json.assignment.id}`
  r=await a.call(legacyPath,'PATCH',{title:'旧课程任务已改名',instructions:'拍摄完成后的练习作品，再上传照片。'})
  check('原课程任务仍可单独编辑标题和说明',r.status===200 && r.json.assignment.title==='旧课程任务已改名' && r.json.assignment.instructions==='拍摄完成后的练习作品，再上传照片。' && r.json.assignment.status==='open')
  r=await a.call(legacyPath,'PATCH',{status:'closed'})
  check('原课程任务仅改状态也保留标题和说明',r.status===200 && r.json.assignment.title==='旧课程任务已改名' && r.json.assignment.instructions==='拍摄完成后的练习作品，再上传照片。')
  r=await a.call(legacyPath,'PATCH',{instructions:''})
  check('明确提交空说明仍可清空且不修改标题或状态',r.status===200 && r.json.assignment.instructions==='' && r.json.assignment.title==='旧课程任务已改名' && r.json.assignment.status==='closed')
  console.log(`教学 API 验收 ${passed}/${passed} 通过`)
} finally {
  const fixtures=await prisma.user.findMany({where:{id:{in:created},nickname:marker,email:{endsWith:'@example.invalid'}},select:{id:true}})
  if(fixtures.length) await prisma.user.deleteMany({where:{id:{in:fixtures.map(u=>u.id)},nickname:marker}})
  const remaining=await prisma.user.count({where:{id:{in:created}}})
  await prisma.$disconnect()
  assert.equal(remaining,0,'测试账号清理失败')
  console.log('TEST_FIXTURES_CLEANED')
}
