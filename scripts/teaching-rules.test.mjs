import test from 'node:test'
import assert from 'node:assert/strict'
import { memberInputSchema, memberPatchSchema, assertRoster, planRosterOperations, assertGroupPartition, rosterNameKey } from '../src/lib/teaching-roster.ts'
import { quizDefinitionSchema, gradeQuiz, projectQuiz, studentQuizResult, parseQuizSubmission, parseQuizDefinition } from '../src/lib/teaching-quiz.ts'

const member = (id, name, studentNo = null) => ({id, name, studentNo, gender:null,score:null})
const quiz = quizDefinitionSchema.parse({questions:[
  {id:'q1',type:'single',stem:'哪项是输入设备？',options:['键盘','显示器','音箱'],answer:0,points:3,explanation:'键盘用于输入。'},
  {id:'q2',type:'boolean',stem:'计算机可以处理数据。',options:['正确','错误'],answer:0,points:7,explanation:'这是计算机的基本功能。'},
]})

test('名单保留前导零，缺失可选字段为空，PATCH遗漏不清除字段', () => {
  assert.deepEqual(memberInputSchema.parse({name:'　小明\n',studentNo:'0012'}), {name:'小明',studentNo:'0012',gender:null,score:null})
  assert.deepEqual(memberPatchSchema.parse({name:'小丽'}), {name:'小丽'})
  assert.deepEqual(memberPatchSchema.parse({gender:' '}), {gender:null})
})
test('同名必须有不同学号，学号不得重复', () => {
  assert.doesNotThrow(()=>assertRoster([member('a','张三','001'),member('b','张三','002')]))
  assert.throws(()=>assertRoster([member('a','张三'),member('b','张三','002')]), /同名/)
  assert.throws(()=>assertRoster([member('a','张三','001'),member('b','李四','001')]), /学号/)
})
test('姓名键统一全角与大小写，同时保留不同的带音调姓名', () => {
  assert.equal(rosterNameKey(' Ａlice '),rosterNameKey('alice'))
  assert.notEqual(rosterNameKey('René'),rosterNameKey('Rene'))
  assert.doesNotThrow(()=>assertRoster([member('a','René'),member('b','Rene')]))
})
test('成员更新拒绝空操作和隐藏控制字符，保留合法零分', () => {
  assert.equal(memberPatchSchema.safeParse({}).success,false)
  assert.equal(memberPatchSchema.safeParse({unknown:'value'}).success,false)
  assert.equal(memberInputSchema.safeParse({name:'甲',studentNo:'001\n002'}).success,false)
  assert.equal(memberInputSchema.safeParse({name:'甲',gender:'女\u0000'}).success,false)
  assert.equal(memberInputSchema.parse({name:'甲',score:0}).score,0)
})
test('批量修改以最终名单验证，支持学号交换且不污染原列表', () => {
  const before=[member('a','甲','001'),member('b','乙','002')]
  const snapshot=JSON.stringify(before)
  const after=planRosterOperations(before,[{action:'update',id:'a',studentNo:'002'},{action:'update',id:'b',studentNo:'001'}])
  assert.equal(JSON.stringify(before),snapshot)
  assert.deepEqual(after.members.map(m=>m.studentNo),['002','001'])
})
test('批量操作拒绝越班编号、重复修改、重复姓名及超额', () => {
  assert.throws(()=>planRosterOperations([member('a','甲')],[{action:'delete',id:'other'}]), /不属于/)
  assert.throws(()=>planRosterOperations([member('a','甲')],[{action:'update',id:'a',name:'乙'},{action:'delete',id:'a'}]), /重复修改/)
  assert.throws(()=>planRosterOperations([member('a','甲')],[{action:'add',name:'甲'}]), /同名/)
  assert.throws(()=>assertRoster(Array.from({length:101},(_,i)=>member(String(i),String(i)))), /100/)
})
test('分组必须覆盖且只覆盖本班成员，每人恰好一次', () => {
  assert.doesNotThrow(()=>assertGroupPartition(['a','b'],[{name:'一组',memberIds:['a']},{name:'二组',memberIds:['b']}]))
  assert.throws(()=>assertGroupPartition(['a','b'],[{name:'一组',memberIds:['a']}]), /全部/)
  assert.throws(()=>assertGroupPartition(['a'],[{name:'一组',memberIds:['a','a']}]), /多个/)
  assert.throws(()=>assertGroupPartition(['a'],[{name:'一组',memberIds:['b']}]), /不属于/)
  assert.throws(()=>assertGroupPartition(['a','b'],[{name:'A',memberIds:['a']},{name:'a',memberIds:['b']}]), /名称/)
})
test('题目定义拒绝重复编号、错误判断选项、越界答案和多选题', () => {
  const q=quiz.questions[0]
  for(const questions of [[q,q],[{...q,type:'boolean'}],[{...q,answer:7}],[{...q,type:'multiple'}],[{...q,options:['重复','重复']}]] ) {
    assert.equal(quizDefinitionSchema.safeParse({questions}).success,false)
  }
})
test('服务端按稳定题号计分，不依赖答案排列顺序', () => {
  const result=gradeQuiz(quiz,[{questionId:'q2',answer:1},{questionId:'q1',answer:0}])
  assert.equal(result.score,3)
  assert.equal(result.totalPoints,10)
  assert.deepEqual(result.answers,[{questionId:'q1',answer:0},{questionId:'q2',answer:1}])
})
test('计分拒绝缺答、重复题号、未知题号及越界选项', () => {
  for(const answers of [[{questionId:'q1',answer:0}], [{questionId:'q1',answer:0},{questionId:'q1',answer:0}], [{questionId:'q1',answer:0},{questionId:'unknown',answer:0}], [{questionId:'q1',answer:7},{questionId:'q2',answer:0}]]) {
    assert.throws(()=>gradeQuiz(quiz,answers))
  }
})
test('公开题面不包含标准答案或解析', () => {
  const publicQuiz=projectQuiz(quiz)
  assert.equal(publicQuiz.totalPoints,10)
  assert.ok(publicQuiz.questions.every(q=>!('answer' in q) && !('explanation' in q)))
})
test('未公布时已提交学生也不能读取得分和标准答案', () => {
  const graded=gradeQuiz(quiz,[{questionId:'q1',answer:0},{questionId:'q2',answer:0}])
  const result=studentQuizResult({quizJson:JSON.stringify(quiz),scoresPublished:false,answersPublished:false},{status:'submitted',content:JSON.stringify(graded),score:10})
  assert.equal('score' in result,false)
  assert.equal('score' in result.content,false)
  assert.ok(result.quiz.questions.every(q=>!('answer' in q) && !('explanation' in q)))
})
test('成绩与答案分开公布，未提交学生不能借公布状态取得解答', () => {
  const assignment={quizJson:JSON.stringify(quiz),scoresPublished:true,answersPublished:false}
  const submitted={status:'submitted',content:JSON.stringify({kind:'quiz',answers:[{questionId:'q1',answer:1}]}),score:7}
  const scoreOnly=studentQuizResult(assignment,submitted)
  assert.equal(scoreOnly.score,7)
  assert.ok(scoreOnly.quiz.questions.every(q=>!('answer' in q)))
  const answersOnly=studentQuizResult({...assignment,scoresPublished:false,answersPublished:true},submitted)
  assert.equal('score' in answersOnly,false)
  assert.equal(answersOnly.quiz.questions[0].answer,0)
  const notSubmitted=studentQuizResult({...assignment,answersPublished:true},{...submitted,status:'started'})
  assert.equal('score' in notSubmitted,false)
  assert.equal(notSubmitted.content,null)
  assert.ok(notSubmitted.quiz.questions.every(q=>!('answer' in q)))
})
test('存储解析不把服务端计分元数据透传给学生', () => {
  assert.deepEqual(parseQuizSubmission(JSON.stringify({kind:'quiz',answers:[{questionId:'q1',answer:0}],score:99,explanation:'secret'})),{kind:'quiz',answers:[{questionId:'q1',answer:0}]})
  assert.equal(parseQuizSubmission('{broken'),null)
  assert.equal(parseQuizDefinition('{broken'),null)
})
