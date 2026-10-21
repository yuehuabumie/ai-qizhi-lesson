/** Full teaching modules, mocked API: no accounts, mail or production writes. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const classSource = readFileSync(new URL('./class-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((err) => {', '  Promise.resolve().catch((err) => {')
  .replace(/\}\)\(\);?\s*$/, `
    globalThis.__classUI = { mount(mode='class'){unmountPage();mountPage({$el:null},mode,{id:'c1',assignmentId:'a1'})}, unmountPage, parseRosterText, distributeGroups, closeModal };
  })()`)
const studentSource = readFileSync(new URL('./storybook-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((err) => {', '  Promise.resolve().catch((err) => {')
  .replace(/\}\)\(\);?\s*$/, `
    globalThis.__studentUI = {
      mount(member=window.__member,submission=window.__submission){
        if(root) detachRoot();state=freshState();state.mode='assign';state.assignToken='fixture-token';
        state.assignMeta=JSON.parse(JSON.stringify(window.__meta));state.assignMember=member;state.assignSubmission=submission;
        attachRoot({$el:null});routeAssignSession();mountStudio();
      }, loadAssign, getState:()=>({status:state.assignStatus,busy:state.assignBusy})
    };
  })()`)
const css = readFileSync(new URL('../site/assets/index-D-SlqVZT.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('./responsive-shell.js', import.meta.url), 'utf8')
const browser = await launch()
let passed = 0
async function check(name, expression) { assert.ok(await browser.evaluate(expression), name); console.log(`PASS ${name}`); passed++ }
async function click(selector) { await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`) }
async function input(selector, value) { await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`) }
const output = process.env.TEACHING_UI_OUTPUT
if (output) mkdirSync(output, { recursive: true })
async function phoneShots(name,scrollTo=''){
  if(!output)return
  await browser.waitFor(`!document.querySelector('.cls-toast')||getComputedStyle(document.querySelector('.cls-toast')).opacity==='0'`)
  const before=await browser.evaluate(`({width:innerWidth,height:innerHeight})`)
  for(const [width,height] of [[320,740],[390,844]]){
    await browser.setViewport(width,height,{mobile:true})
    if(await browser.evaluate(`!!document.querySelector('.cls-modal')`))await browser.waitFor(`getComputedStyle(document.querySelector('.cls-modal')).transform==='none'`)
    await browser.evaluate(`window.scrollTo(0,0);${scrollTo?`document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});`:''}`)
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=${width}+1`),`screenshot ${name} has no ${width}px horizontal overflow`)
    await browser.screenshot(`${output}/${name}-${width}.png`)
  }
  await browser.setViewport(before.width,before.height,{mobile:before.width<1024})
}

try {
  await browser.evaluate(`
    document.head.innerHTML='<meta name="viewport" content="width=device-width, initial-scale=1">';
    // The real Vue header supplies its containing block through scoped CSS.
    // Match that here so its backdrop pseudo-element stays inside the header.
    document.body.innerHTML='<div id="app"><header class="aiq-navbar" style="position:relative;height:74px"></header><main></main></div>';
    const base=document.createElement('style');base.textContent=${JSON.stringify(css)};document.head.append(base);
    ${responsive}
    window.confirm=()=>true;
    window.__reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    window.__members=[{id:'m1',name:'李明',studentNo:'001',gender:'男',score:0},{id:'m2',name:'李明',studentNo:'002',gender:'男',score:90},{id:'m3',name:'王小雨',studentNo:null,gender:'女',score:80},{id:'m4',name:'陈晨',studentNo:null,gender:null,score:null}];
    window.__class={id:'c1',name:'三年级测试班',memberCount:4,members:__members,assignments:[],createdAt:'2026-10-21T00:00:00Z'};
    window.__questions=[{id:'q1',type:'single',stem:'哪一种设备可以识别语音？',options:['智能音箱','普通水杯'],answer:0,points:10,explanation:'智能音箱能够处理语音指令。'},{id:'q2',type:'boolean',stem:'人工智能的回答总是正确。',options:['正确','错误'],answer:1,points:10,explanation:'模型也会出错，需要核实。'}];
    window.__assignment={id:'a1',className:__class.name,title:'AI 小测验',type:'quiz',status:'draft',instructions:'请独立完成。',token:'fixture-token',quiz:{questions:__questions},scoresPublished:false,answersPublished:false,stats:{total:4,submitted:1,started:1,notStarted:2},createdAt:'2026-10-21T00:00:00Z'};
    window.__groups=[];window.__calls=[];window.__deferSubmit=false;window.__failSubmit=false;window.__conflictSubmit=false;window.__submitCount=0;
    window.__member={id:'m1',name:'李明',studentNo:'001'};
    window.__meta={...__assignment,status:'open',teacherName:'老师',quiz:{questions:__questions.map(({answer,explanation,...q})=>q)}};
    window.__submission={type:'quiz',status:'started',quiz:__meta.quiz,content:null};
    window.fetch=async(path,options={})=>{
      const method=options.method||'GET';const body=options.body?JSON.parse(options.body):null;__calls.push({path,method,body});
      if(path==='/api/classes/c1/groups'){
        if(method==='PUT'){__groups=body.groups.map((g,i)=>({id:'g'+i,name:g.name,members:g.memberIds.map(id=>__members.find(m=>m.id===id))}));return __reply({groups:__groups})}
        return __reply({groups:__groups});
      }
      if(path==='/api/classes/c1/members'&&method==='POST')return __reply({added:body.members.length,skipped:0});
      if(path.startsWith('/api/classes/c1/members/')&&method==='PATCH'){Object.assign(__members.find(m=>m.id===path.split('/').pop()),body);return __reply({ok:true})}
      if(path==='/api/classes/c1/assignments'&&method==='POST'){Object.assign(__assignment,body);return __reply({assignment:__assignment})}
      if(path==='/api/classes/c1/assignments/a1'){
        if(method==='PATCH'){Object.assign(__assignment,body);return __reply({assignment:__assignment})}
        return __reply({assignment:__assignment,members:[{...__members[0],status:'submitted',score:10,submissionId:'sub1'}],stats:__assignment.stats});
      }
      if(path==='/api/classes/c1')return __reply({class:__class});
      if(path==='/api/assign/fixture-token')return __reply({assignment:__meta});
      if(path.endsWith('/me'))return __reply({member:__member,submission:__submission});
      if(path.endsWith('/verify')){
        if(body.name==='李明'&&!body.studentNo)return __reply({error:{message:'班级存在同名学生，请填写学号'}},409);
        return __reply({member:__member,submission:__submission});
      }
      if(path.endsWith('/leave'))return __reply({ok:true});
      if(path.endsWith('/submit')){
        __submitCount++;
        const finish=()=>{if(__failSubmit)return __reply({error:{message:'模拟网络故障'}},503);__submission={type:'quiz',status:'submitted',quiz:__meta.quiz,content:{kind:'quiz',answers:body.answers}};if(__conflictSubmit)return __reply({error:{message:'已经提交，请勿重复提交'}},409);return __reply({submission:{type:'quiz',status:'submitted'}})};
        if(__deferSubmit)return new Promise(resolve=>{window.__finishSubmit=()=>resolve(finish())});
        return finish();
      }
      throw new Error('Unexpected mocked API: '+method+' '+path);
    };
    ${classSource}
    __classUI.mount();
  `)
  await browser.waitFor(`!!document.querySelector('[data-form="create-assignment"]')`)
  await phoneShots('teacher-roster','.cls-roster')
  await check('table import preserves leading-zero IDs, zero scores and optional fields', `(()=>{const r=__classUI.parseRosterText(${JSON.stringify("姓名\t学号\t性别\t成绩\n李明\t001\t男\t0\n王小雨\t002\t\t")});return r.length===2&&r[0].studentNo==='001'&&r[0].score===0&&r[1].gender===null&&r[1].score===null})()`)
  await check('plain comma-separated names remain compatible', `__classUI.parseRosterText('李明，王小雨').map(m=>m.name).join('|')==='李明|王小雨'`)
  await check('a table row without a name is rejected rather than shifted', `(()=>{try{__classUI.parseRosterText(${JSON.stringify("姓名\t学号\n\t003")});return false}catch{return true}})()`)
  await check('grouping retains every student once and balances group size', `['random','gender','score'].every(mode=>{const groups=__classUI.distributeGroups(__members,3,mode),ids=groups.flatMap(g=>g.memberIds);return ids.length===4&&new Set(ids).size===4&&Math.max(...groups.map(g=>g.memberIds.length))-Math.min(...groups.map(g=>g.memberIds.length))<=1})`)
  await click('[data-act="rename-member"]')
  await check('member editor keeps a zero score and a leading-zero ID', `document.querySelector('[name=score]').value==='0'&&document.querySelector('[name=studentNo]').value==='001'`)
  await phoneShots('teacher-member-edit')
  await input('[name="studentNo"]','0007')
  await click('.cls-modal [type="submit"]')
  await browser.waitFor(`!document.querySelector('.cls-modal')`)
  await check('member updates send optional fields without coercing student IDs', `__calls.some(c=>c.path.endsWith('/members/m1')&&c.body.studentNo==='0007'&&c.body.score===0)`)
  await click('[data-act="edit-groups"]')
  await input('[data-group-count]',2)
  await click('[data-group-generate]')
  await click('.cls-modal [type="submit"]')
  await browser.waitFor(`!document.querySelector('.cls-modal')`)
  await check('saved groups are rendered with individual-submission guidance', `document.querySelectorAll('.cls-group-card').length===2&&document.querySelector('.cls-groups-card').textContent.includes('单独完成')`)
  await check('closing the group editor restores page focusability and removes its backdrop', `!document.querySelector('.cls-modal-backdrop')&&!document.querySelector('#app').inert&&document.body.style.overflow!=='hidden'`)
  await click('[data-act="edit-groups"]')
  await check('reopening groups restores the saved membership', `[...document.querySelectorAll('[data-group-member]')].every(e=>__groups[Number(e.value)].members.some(m=>m.id===e.dataset.groupMember))`)
  await check('same-name students have distinct accessible group labels', `new Set([...document.querySelectorAll('[data-group-member]')].map(e=>e.getAttribute('aria-label'))).size===__members.length`)
  await browser.setViewport(320,740,{mobile:true})
  await browser.waitFor(`getComputedStyle(document.querySelector('.cls-modal')).transform==='none'`)
  await check('320px group editor keeps every student selector inside the dialog', `document.documentElement.scrollWidth<=321&&[...document.querySelectorAll('[data-group-member]')].every(e=>e.getBoundingClientRect().right<=document.querySelector('.cls-modal').getBoundingClientRect().right&&e.getBoundingClientRect().height>=44)`)
  await phoneShots('teacher-groups-edit')
  await phoneShots('teacher-groups-edit-actions','.cls-modal-actions')
  await click('[data-act="close-modal"]')
  await input('[name="type"]','quiz')
  await input('[name="title"]','课堂试卷')
  await input('[data-q-field="stem"]','选择正确的答案')
  await input('[data-q-field="options"]','第一个选项\n第二个选项')
  await click('[data-act="quiz-add-question"]')
  await input('[data-quiz-question]:last-child [data-q-field="type"]','boolean')
  await input('[data-quiz-question]:last-child [data-q-field="stem"]','这是一道判断题。')
  await input('[data-quiz-question]:last-child [data-q-field="answer"]','1')
  await browser.setViewport(320,740,{mobile:true})
  await check('320px teacher editor stays within the viewport', `document.documentElement.scrollWidth<=321&&[...document.querySelectorAll('[data-quiz-builder] textarea')].every(e=>e.getBoundingClientRect().right<=321)`)
  if(output)await browser.waitFor(`!document.querySelector('.cls-toast')||getComputedStyle(document.querySelector('.cls-toast')).opacity==='0'`)
  await phoneShots('teacher-quiz','[data-quiz-builder]')
  await click('[data-create-label]')
  await check('quiz preview includes the teacher answer before any write', `document.querySelector('.cls-modal').textContent.includes('标准答案')&&!__calls.some(c=>c.path==='/api/classes/c1/assignments'&&c.method==='POST')`)
  await browser.waitFor(`getComputedStyle(document.querySelector('.cls-modal')).transform==='none'`)
  await check('320px teacher preview remains within the screen', `document.querySelector('.cls-modal').getBoundingClientRect().right<=321&&document.documentElement.scrollWidth<=321&&document.querySelector('[data-quiz-save]').getBoundingClientRect().height>=44`)
  await click('[data-quiz-save]')
  await browser.waitFor(`!document.querySelector('.cls-modal')`)
  await check('confirmed quiz save sends a draft with stable question IDs', `(()=>{const c=__calls.find(c=>c.path==='/api/classes/c1/assignments'&&c.method==='POST');return c.body.status==='draft'&&c.body.quiz.questions.length===2&&new Set(c.body.quiz.questions.map(q=>q.id)).size===2&&c.body.quiz.questions[1].type==='boolean'})()`)
  await browser.evaluate(`__classUI.mount('assignment')`)
  await browser.waitFor(`!!document.querySelector('[data-act="publish-quiz-scores"]')`)
  await check('quiz teacher controls omit gallery publication and resetting', `!document.querySelector('[data-act="publish-submission"]')&&!document.querySelector('[data-act="reset-submission"]')&&!!document.querySelector('[data-act="edit-quiz"]')`)
  await click('[data-act="edit-quiz"]')
  await input('#cls-edit-quiz-title','修改后的课堂试卷')
  await click('.cls-modal [type="submit"]')
  await click('[data-quiz-back]')
  await check('returning from draft preview keeps edited fields and stable question IDs', `document.querySelector('#cls-edit-quiz-title').value==='修改后的课堂试卷'&&[...document.querySelectorAll('.cls-modal [data-quiz-question]')].every((e,i)=>e.dataset.quizQuestion===__assignment.quiz.questions[i].id)`)
  await click('.cls-modal [type="submit"]')
  await click('[data-quiz-save]')
  await browser.waitFor(`!document.querySelector('.cls-modal')&&document.querySelector('h1')?.textContent.includes('修改后的课堂试卷')`)
  await check('draft edits patch content without accidentally publishing the quiz', `__calls.some(c=>c.method==='PATCH'&&c.body.title==='修改后的课堂试卷'&&c.body.status===undefined)&&__assignment.status==='draft'`)
  await click('[data-act="toggle-assignment"]')
  await browser.waitFor(`__assignment.status==='open'&&!document.querySelector('[data-act="edit-quiz"]')`)
  await check('publishing a draft removes question editing controls', `!document.querySelector('[data-act="edit-quiz"]')&&__calls.some(c=>c.method==='PATCH'&&c.body.status==='open')`)
  await click('[data-act="publish-quiz-scores"]')
  await browser.waitFor(`__assignment.scoresPublished`)
  await check('score publication does not also publish answers', `__assignment.scoresPublished===true&&__assignment.answersPublished===false`)
  await browser.waitFor(`!!document.querySelector('[data-act="publish-quiz-answers"]')`)
  await click('[data-act="publish-quiz-answers"]')
  await browser.waitFor(`__assignment.answersPublished`)
  await check('answer publication has its own explicit operation', `__calls.some(c=>c.method==='PATCH'&&c.body.answersPublished===true&&c.body.scoresPublished===undefined)`)
  await browser.waitFor(`document.querySelector('[data-act="publish-quiz-answers"]').disabled`)
  await check('published feedback controls remain disabled after busy state clears', `document.querySelector('[data-act="publish-quiz-scores"]').disabled&&document.querySelector('[data-act="publish-quiz-answers"]').disabled`)

  await browser.evaluate(`__classUI.unmountPage();${studentSource};__studentUI.mount(null,null)`)
  await input('#sbk-assign-name','李明')
  await click('.sbk-assign-form [type="submit"]')
  await browser.waitFor(`document.querySelector('#sbk-assign-name-error')?.textContent.includes('同名')`)
  await check('ambiguous names remain at the identity gate and request a student number', `!!document.querySelector('#sbk-assign-student-no')&&!document.querySelector('[data-quiz-answer]')`)
  await input('#sbk-assign-student-no','0007')
  await click('.sbk-assign-form [type="submit"]')
  await browser.waitFor(`!!document.querySelector('[data-quiz-answer]')`)
  await check('student verification sends the optional student number', `__calls.some(c=>c.path.endsWith('/verify')&&c.body.name==='李明'&&c.body.studentNo==='0007')`)
  await click('[data-act="assign-quiz-submit"]')
  await check('incomplete quiz focuses an unanswered question and makes no submit call', `__submitCount===0&&document.activeElement.matches('[data-quiz-answer]')&&document.querySelector('[role=alert]').textContent.includes('没有作答')`)
  await click('[data-quiz-answer="q1"][value="0"]')
  await click('[data-quiz-answer="q2"][value="1"]')
  await check('radio selections update progress without replacing focusable controls', `document.querySelector('[data-quiz-progress]').textContent.includes('2 / 2')&&document.querySelectorAll('.sbk-quiz-option.is-selected').length===2`)
  await check('answering clears the stale missing-answer validation message', `document.querySelector('.sbk-assign-error[role=alert]').textContent===''`)
  await check('320px student question labels retain 44px touch targets', `document.documentElement.scrollWidth<=321&&[...document.querySelectorAll('.sbk-quiz-option')].every(e=>e.getBoundingClientRect().height>=44&&e.getBoundingClientRect().right<=321)`)
  await phoneShots('student-quiz','.sbk-quiz-questions')
  await browser.evaluate(`__deferSubmit=true;__failSubmit=true`)
  await click('[data-act="assign-quiz-submit"]')
  await browser.waitFor(`getComputedStyle(document.querySelector('[role="dialog"]')).transform==='none'`)
  await check('320px one-time submission confirmation keeps accessible touch controls', `document.querySelector('[data-modal-ok]').getBoundingClientRect().height>=44&&document.querySelector('[data-modal-ok]').getBoundingClientRect().right<=321&&!!document.querySelector('[role="dialog"][aria-modal="true"]')`)
  await click('[data-modal-ok]')
  await browser.waitFor(`typeof __finishSubmit==='function'`)
  await check('pending submission locks answers and prevents a second request', `__submitCount===1&&[...document.querySelectorAll('.sbk-quiz-question')].every(e=>e.disabled)&&document.querySelector('[data-act="assign-quiz-submit"]').disabled`)
  await browser.evaluate(`__finishSubmit()`)
  await browser.waitFor(`!__studentUI.getState().busy`)
  await check('failed submit preserves choices and restores the submit action', `document.querySelector('[data-quiz-answer="q2"][value="1"]').checked&&!document.querySelector('[data-act="assign-quiz-submit"]').disabled&&document.querySelector('[role=alert]').textContent.includes('模拟网络故障')`)
  await browser.evaluate(`__deferSubmit=false;__failSubmit=false`)
  await click('[data-act="assign-quiz-submit"]')
  await click('[data-modal-ok]')
  await browser.waitFor(`__studentUI.getState().status==='submitted'`)
  await check('successful submission shows submitted without score, answer or retake controls', `document.querySelector('h1').textContent==='已提交'&&!document.querySelector('.sbk-quiz-score')&&!document.querySelector('.sbk-quiz-correct')&&!document.querySelector('[data-act="assign-quiz-submit"]')`)
  await check('submitted status badge contains a visible nonempty SVG mark', `(()=>{const svg=document.querySelector('.sbk-quiz-submitted .sbk-assign-badge svg');return !!svg&&svg.getBoundingClientRect().width>0&&svg.getBoundingClientRect().height>0&&[...svg.querySelectorAll('path,circle,rect,polyline')].some(e=>{const b=e.getBBox();return b.width>0&&b.height>0})})()`)
  await phoneShots('student-quiz-submitted','.sbk-quiz-submitted')
  await browser.evaluate(`__meta.scoresPublished=true;__submission.score=20`)
  await click('[data-act="assign-retry"]')
  await browser.waitFor(`!!document.querySelector('.sbk-quiz-score')`)
  await check('published score appears while answers remain hidden', `document.querySelector('.sbk-quiz-score').textContent.includes('20')&&!document.querySelector('.sbk-quiz-correct')`)
  await browser.evaluate(`__meta.answersPublished=true;__submission.quiz={questions:__questions}`)
  await click('[data-act="assign-retry"]')
  await browser.waitFor(`!!document.querySelector('.sbk-quiz-correct')`)
  await check('published answer and explanation are read from the authenticated submission', `document.querySelector('.sbk-quiz-review').textContent.includes('标准答案')&&document.querySelector('.sbk-quiz-review').textContent.includes('模型也会出错')`)
  await browser.evaluate(`__meta.status='closed';__studentUI.mount(null,null)`)
  await check('closed quiz still offers identity verification for previous submissions', `!!document.querySelector('[data-assign-form]')&&document.querySelector('[type=submit]').textContent.includes('查看已提交试卷')`)
  await browser.evaluate(`__studentUI.mount(__member,__submission)`)
  await check('closed quiz still shows already-submitted results with no retry action', `document.querySelector('h1').textContent==='已提交'&&!document.querySelector('[data-act="assign-quiz-submit"]')`)
  await browser.evaluate(`__studentUI.mount(__member,{type:'quiz',status:'started',quiz:__meta.quiz,content:null})`)
  await check('closed quiz prevents an unsubmitted student from answering', `!document.querySelector('[data-quiz-answer]')&&!document.querySelector('[data-act="assign-quiz-submit"]')`)
  await browser.evaluate(`__meta.status='open';__meta.scoresPublished=false;__meta.answersPublished=false;__conflictSubmit=true;__studentUI.mount(__member,{type:'quiz',status:'started',quiz:__meta.quiz,content:null})`)
  await click('[data-quiz-answer="q1"][value="0"]')
  await click('[data-quiz-answer="q2"][value="1"]')
  await click('[data-act="assign-quiz-submit"]')
  await click('[data-modal-ok]')
  await browser.waitFor(`__studentUI.getState().status==='submitted'`)
  await check('a duplicate-submit conflict recovers the server submission without a retake', `document.querySelector('h1').textContent==='已提交'&&!document.querySelector('[data-act="assign-quiz-submit"]')&&!document.querySelector('.sbk-quiz-score')`)
  await browser.evaluate(`__meta.scoresPublished=true;__meta.answersPublished=true;__studentUI.mount(__member,{type:'quiz',status:'started',score:20,quiz:{questions:__questions},content:null})`)
  await check('publication flags do not expose scores or answer keys before submission', `!!document.querySelector('[data-quiz-answer]')&&!document.querySelector('.sbk-quiz-score')&&!document.querySelector('.sbk-quiz-correct')`)
  await browser.evaluate(`__meta.type='lab';__studentUI.mount(__member,{type:'lab',status:'started',content:null})`)
  await check('existing lab assignments retain their practice flow', `!!document.querySelector('[data-act="assign-open-lab"]')&&!document.querySelector('[data-act="assign-quiz-submit"]')`)
  await browser.evaluate(`__meta.type='task';__studentUI.mount(__member,{type:'task',status:'started',content:null})`)
  await check('existing task assignments retain text and photo inputs', `!!document.querySelector('[data-assign-task-text]')&&!!document.querySelector('[data-assign-task-file]')&&!!document.querySelector('[data-act="assign-task-submit"]')`)
  await browser.evaluate(`__meta.type='storybook';__studentUI.mount(__member,{type:'storybook',status:'started',content:null})`)
  await check('existing storybook assignments retain the composition editor', `__studentUI.getState().status==='editor'&&!!document.querySelector('[data-field="who"]')&&!document.querySelector('[data-quiz-answer]')`)
  console.log(`教学组件验收 ${passed}/${passed} 通过`)
} finally { await browser.close() }

