/** Isolated preparation UI regressions. Mocked API only; no accounts or business writes. */
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const source = readFileSync(new URL('./prep-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((e) =>', '  Promise.resolve().catch((e) =>')
  .replace(/\}\)\(\)\s*$/, `
    globalThis.__prepTest = { mount(id='') {mountPage({$el:null},id)}, openSession, poll, unmountPage, injectNav };
  })()`)
const css = readFileSync(new URL('../site/assets/index-D-SlqVZT.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('./responsive-shell.js', import.meta.url), 'utf8')
const browser = await launch()
let passed = 0
const output = process.env.E2E_OUTPUT
if(output) mkdirSync(output,{recursive:true})
async function phoneShots(name,{panel='chat',scrollTo='',openDetails=false}={}){
  if(!output)return
  await browser.waitFor(`!document.querySelector('.prep-toast:not([hidden])')`)
  const before=await browser.evaluate(`({width:innerWidth,height:innerHeight,dark:document.documentElement.classList.contains('dark'),panel:document.querySelector('[data-prep-root]').dataset.panel})`)
  for(const [width,height] of [[320,740],[390,844]]){
    await browser.setViewport(width,height,{mobile:true})
    await browser.evaluate(`(()=>{document.documentElement.classList.remove('dark');document.querySelector('[data-prep-panel="${panel}"]').click();window.scrollTo(0,0);const modal=document.querySelector('.prep-modal');if(modal)modal.scrollTop=0;${openDetails?`document.querySelectorAll('[data-prep-events] details').forEach(e=>e.open=true);`:''}${scrollTo?`document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});`:''}})()`)
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=${width}+1`),`screenshot ${name} has no ${width}px horizontal overflow`)
    await browser.screenshot(`${output}/${name}-${width}.png`)
  }
  await browser.setViewport(before.width,before.height,{mobile:before.width<1024})
  await browser.evaluate(`document.documentElement.classList.toggle('dark',${before.dark});document.querySelector('[data-prep-panel="${before.panel}"]').click()`)
}
async function check(name, expression) { assert.ok(await browser.evaluate(expression), name); console.log(`PASS ${name}`); passed++ }
async function click(selector) { await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).click()`) }
async function key(name, modifiers=0) { await browser.page.send('Input.dispatchKeyEvent',{type:'keyDown',key:name,modifiers,windowsVirtualKeyCode:name==='Escape'?27:name==='Tab'?9:undefined}); await browser.page.send('Input.dispatchKeyEvent',{type:'keyUp',key:name}) }
try {
  await browser.evaluate(`
    document.head.innerHTML='<meta name="viewport" content="width=device-width, initial-scale=1">';
    let fixtureUuid=0;crypto.randomUUID ||= ()=>'fixture-'+(++fixtureUuid);
    document.body.innerHTML='<div id="app"><header class="aiq-navbar"><nav><a href="#/teach" class="nav-item">课堂教学</a></nav><div class="el-drawer__body"><div><a href="#/teach">课堂教学</a></div></div></header><main></main></div>';
    const base=document.createElement('style');base.textContent=${JSON.stringify(css)};document.head.append(base);
    ${responsive}
    window.__reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    window.__sessions=[{id:'s1',title:'科学探究课',status:'completed',updatedAt:'2026-10-21T00:00:00Z'},{id:'s2',title:'第二个独立对话',status:'completed',updatedAt:'2026-10-21T00:00:00Z'}];
    window.__details={
      s1:{session:__sessions[0],messages:[{id:'u1',role:'user',content:'<img src=x onerror="window.__xss=1">教材',attachmentIds:[],createdAt:'2026-10-21T00:00:00Z'},{id:'a1',role:'assistant',content:'请核对名单，再确认创建。',attachmentIds:[],createdAt:'2026-10-21T00:00:01Z'}],events:[{id:1,type:'reasoning',data:{text:'先读取材料，核对同名与学号。'}},{id:2,type:'tool-start',data:{name:'create_class',callId:'call1',input:{name:'三年一班'}}},{id:3,type:'tool-result',data:{name:'create_class',callId:'call1',output:{message:'等待确认 <img onerror=x>'}}}],attachments:[{id:'f1',name:'科学教案.docx',mime:'application/octet-stream',size:1024,kind:'artifact'}],proposals:[{id:'p1',tool:'create_class',description:'创建三年一班',version:'v1',status:'pending',payload:{name:'三年一班',members:[{name:'张三',studentNo:'001',gender:null,score:null}]},preview:{className:'三年一班',members:[{name:'张三',studentNo:'001',gender:null,score:null}]}}],activeRun:null},
      s2:{session:__sessions[1],messages:[],events:[],attachments:[],proposals:[],activeRun:null}
    };
    window.__skills=[];window.__requests=[];window.__uploadFailures=0;window.__uploadCount=0;window.__created=0;window.__confirmConflict=false;window.__deleteFailure=false;window.__skillFailure=false;window.__deferS1=false;
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://fixture.invalid');const p=url.pathname;const method=options.method||'GET';const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
      __requests.push({p,method,body:body instanceof Blob?{isBlob:true,size:body.size}:body});
      if(p==='/api/prep/status'){const result={enabled:window.__enabled!==false,userId:window.__owner||'teacher1',model:'deepseek-flash',limits:{maxFileBytes:26214400,maxAttachments:10}};return window.__deferStatus?new Promise(resolve=>{window.__finishStatus=()=>resolve(__reply(result))}):__reply(result);}
      if(p==='/api/prep/sessions'&&method==='GET')return __reply({sessions:__sessions});
      if(p==='/api/prep/sessions'&&method==='POST'){
        const session={id:'new'+(++__created),title:'新的备课对话',status:'completed',updatedAt:'2026-10-21T00:00:00Z'};__sessions.push(session);__details[session.id]={session,messages:[],events:[],attachments:[],proposals:[],activeRun:null};return __reply({session});
      }
      if(p==='/api/prep/skills'&&method==='GET')return __reply({skills:__skills});
      if(p==='/api/prep/skills'&&method==='POST'){if(__skillFailure)return __reply({error:{message:'保存暂时失败'}},503);const skill={id:'skill1',...body};__skills.push(skill);return __reply({skill});}
      if(p==='/api/prep/skills/skill1'&&method==='DELETE'){__skills=[];return __reply({ok:true});}
      if(p==='/api/prep/proposals/p1'&&method==='PATCH'){const pr=__details.s1.proposals[0];window.__patched=body;pr.payload=body.payload;pr.preview=body.payload;pr.version='v2';return __reply({proposal:pr});}
      if(p==='/api/prep/proposals/p1/confirm'){if(__confirmConflict){__confirmConflict=false;__details.s1.proposals[0].version='v3';return __reply({error:{message:'预览已更新'}},409)}window.__confirmed=body;__details.s1.proposals[0].status='applied';return __reply({ok:true});}
      if(p==='/api/prep/proposals/p1/reject'){__details.s1.proposals[0].status='rejected';return __reply({ok:true});}
      const parts=p.split('/');const match=parts[1]==='api'&&parts[2]==='prep'&&parts[3]==='sessions'?[p,parts[4],parts[5]]:null;
      if(match){const id=match[1],part=match[2],detail=__details[id];if(!detail)return __reply({error:{message:'对话不存在'}},404);
        if(part==='attachments'){if(__uploadFailures-- > 0)return __reply({error:{message:'网络断开，请重试'}},503);const a={id:'up'+(++__uploadCount),name:url.searchParams.get('filename'),size:body.size,mime:body.type,kind:'upload'};detail.attachments.push(a);return __reply({attachment:a});}
        if(part==='messages'){detail.messages.push({id:'user'+__requests.length,role:'user',content:body.content,attachmentIds:body.attachmentIds,createdAt:new Date().toISOString()});detail.activeRun={id:'r1',status:'queued',createdAt:new Date().toISOString()};return __reply({runId:'r1',status:'queued'});}
        if(part==='cancel'){if(window.__deferCancel){detail.activeRun.status='cancelling';return new Promise(resolve=>{window.__finishCancel=()=>{detail.activeRun.status='cancelled';resolve(__reply({run:detail.activeRun}))}})}detail.activeRun.status='cancelled';return __reply({run:detail.activeRun});}
        if(part==='events'&&window.__eventPages?.length){const next=window.__eventPages.shift();detail.hasMore=next.hasMore;detail.events.push(...next.events);return __reply({...detail,events:next.events,hasMore:next.hasMore});}
        if(method==='DELETE'){if(__deleteFailure)return __reply({error:{message:'删除暂时失败'}},503);delete __details[id];__sessions=__sessions.filter(s=>s.id!==id);return __reply({ok:true});}
        if(method==='PATCH'){detail.session.title=body.title;return __reply({session:detail.session});}
        if(id==='s1'&&__deferS1&&!part)return new Promise(resolve=>{window.__finishS1=()=>resolve(__reply(detail))});
        return __reply(detail);
      }
      throw new Error('Unexpected mocked API: '+method+' '+path);
    };
    ${source}
    __prepTest.injectNav();__prepTest.mount('s1');
  `)
  await browser.waitFor(`document.querySelector('[data-prep-title]')?.textContent==='科学探究课' && !document.querySelector('[data-prep-action=new]').disabled`)
  await check('untrusted conversation content is text rather than executable markup', `!window.__xss && !document.querySelector('[data-prep-thread] img') && document.querySelector('[data-prep-thread]').textContent.includes('<img src=x')`)
  await check('actual reasoning is available as a collapsed disclosure', `document.querySelector('.prep-reasoning')?.textContent.includes('先读取材料') && !document.querySelector('.prep-reasoning').open`)
  await check('tool results are grouped with their matching call and escaped', `document.querySelectorAll('[data-prep-events] details:not(.prep-reasoning)').length===1 && document.querySelector('[data-prep-events]').textContent.includes('<img onerror=x>') && !document.querySelector('[data-prep-events] img')`)
  await check('generated files use an authenticated same-origin download route', `document.querySelector('.is-artifact').getAttribute('href')==='/api/prep/attachments/f1' && document.querySelector('.is-artifact').textContent.includes('科学教案.docx')`)
  await check('classroom-changing actions require an explicit confirmation control', `document.querySelector('[data-prep-confirm=p1]')?.textContent==='确认执行' && !__requests.some(r=>r.p.endsWith('/confirm'))`)
  await phoneShots('prep-conversation',{panel:'chat',scrollTo:'.prep-chat'})
  await phoneShots('prep-reasoning-tools',{panel:'activity',scrollTo:'[data-prep-events]',openDetails:true})

  await click('[data-prep-edit=p1]')
  await browser.waitFor(`!!document.querySelector('.prep-modal[open]')`)
  await phoneShots('prep-proposal-edit',{panel:'activity'})
  await phoneShots('prep-proposal-edit-actions',{panel:'activity',scrollTo:'.prep-modal-foot'})
  await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('[data-editor-path]')].find(e=>e.dataset.editorPath==='["members",0,"name"]');e.value='李四';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-dialog-submit]').click()})()`)
  await browser.waitFor(`!document.querySelector('.prep-modal') && document.querySelector('[data-prep-proposals]').textContent.includes('李四')`)
  await check('editing a proposal submits its reviewed version and produces a fresh preview', `__patched.version==='v1' && __patched.payload.members[0].name==='李四' && !__requests.some(r=>r.p.endsWith('/confirm'))`)
  await browser.evaluate(`__confirmConflict=true`)
  await click('[data-prep-confirm=p1]')
  await browser.waitFor(`document.querySelector('[data-prep-error]').textContent.includes('预览已更新')`)
  await check('version conflicts require review of the new preview', `!!document.querySelector('[data-prep-confirm=p1]') && !document.querySelector('[data-prep-confirm=p1]').disabled && !window.__confirmed`)
  await click('[data-prep-confirm=p1]')
  await browser.waitFor(`document.querySelector('[data-prep-proposals]').textContent.includes('已执行')`)
  await check('confirmation is bound to the latest server-provided version', `__confirmed.version==='v3' && !document.querySelector('[data-prep-confirm=p1]')`)

  await browser.evaluate(`__prepTest.openSession('')`)
  await browser.waitFor(`document.querySelector('.prep-welcome')`)
  await check('a new conversation starts without previous messages or file context', `!document.querySelector('[data-prep-message]') && !document.querySelector('.is-artifact') && document.querySelector('#prep-message').value===''`)
  await phoneShots('prep-welcome')
  await phoneShots('prep-welcome-composer',{scrollTo:'.prep-composer'})
  await browser.evaluate(`__uploadFailures=1;const dt=new DataTransfer();dt.items.add(new File(['名单内容'],'学生名单.txt',{type:'text/plain'}));document.querySelector('#prep-message').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))`)
  await browser.waitFor(`!!document.querySelector('[data-prep-retry]')`)
  await check('pasted files show a retryable upload failure and block sending', `document.querySelector('[data-prep-queue]').textContent.includes('网络断开') && document.querySelector('[data-prep-send]').disabled`)
  await click('[data-prep-retry]')
  await browser.waitFor(`document.querySelector('[data-prep-queue]').textContent.includes('KB') && !document.querySelector('[data-prep-retry]')`)
  await check('file retries use raw bytes and retain the selected attachment', `__requests.filter(r=>r.p.endsWith('/attachments')).every(r=>r.body.isBlob) && document.querySelector('[data-prep-queue]').textContent.includes('学生名单.txt') && !document.querySelector('[data-prep-send]').disabled`)
  await browser.evaluate(`const dt2=new DataTransfer();dt2.items.add(new File(['one'],'一.txt',{type:'text/plain'}));dt2.items.add(new File(['two'],'二.txt',{type:'text/plain'}));document.querySelector('#prep-message').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt2}))`)
  await browser.waitFor(`document.querySelectorAll('.prep-upload').length===3 && !document.querySelector('[data-prep-send]').disabled`)
  await check('multiple pasted files share a single new conversation', `__created===1 && document.querySelectorAll('.prep-upload').length===3`)
  await browser.evaluate(`document.querySelector('#prep-message').value='整理这些材料';document.querySelector('#prep-message').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-prep-send]').click()`)
  await browser.waitFor(`document.querySelector('[data-prep-run-status]').textContent==='排队中'`)
  await check('send includes selected attachment ids and clears only a successful draft', `__requests.findLast(r=>r.p.endsWith('/messages')).body.attachmentIds.length===3 && document.querySelector('#prep-message').value==='' && !document.querySelector('.prep-upload')`)
  await check('queued work disables duplicate sending and offers cancellation', `document.querySelector('[data-prep-send]').disabled && !document.querySelector('[data-prep-action=cancel]').hidden`)
  await browser.evaluate(`__details.new1.activeRun.status='running';__details.new1.events=[{id:10,runId:'r1',type:'reasoning',data:{text:'已读取三份资料。'}},{id:11,runId:'r1',type:'text',data:{text:'我已整理出'}}];__prepTest.poll()`)
  await browser.waitFor(`document.querySelector('[data-prep-stream]')?.textContent.includes('我已整理出')`)
  await check('incremental provider events become reasoning and response content', `document.querySelector('[data-prep-events]').textContent.includes('已读取三份资料') && document.querySelector('[data-prep-run-status]').textContent==='正在备课'`)
  await browser.evaluate(`__deferCancel=true`)
  await click('[data-prep-action=cancel]')
  await browser.waitFor(`typeof __finishCancel==='function'`)
  await browser.evaluate(`void __prepTest.poll()`)
  await browser.waitFor(`document.querySelector('[data-prep-run-status]').textContent==='正在停止'`)
  await click('[data-prep-action=cancel]')
  await check('cancellation remains active and prevents duplicate stop requests', `document.querySelector('[data-prep-send]').disabled && document.querySelector('[data-prep-action=cancel]').disabled && document.querySelector('[data-prep-action=cancel]').getAttribute('aria-busy')==='true' && __requests.filter(r=>r.p.endsWith('/cancel')).length===1`)
  await browser.evaluate(`__finishCancel();__deferCancel=false`)
  await browser.waitFor(`document.querySelector('[data-prep-run-status]').textContent==='已停止'`)
  await check('cancel targets the current run instead of deleting the conversation', `__requests.findLast(r=>r.p.endsWith('/cancel')).body.runId==='r1' && __details.new1`)

  await click('[data-prep-action=rename]')
  await browser.evaluate(`document.querySelector('#prep-session-name').value='新的课题';document.querySelector('[data-dialog-submit]').click()`)
  await browser.waitFor(`document.querySelector('[data-prep-title]').textContent==='新的课题'`)
  await check('renaming updates the current conversation and sidebar', `document.querySelector('[data-prep-sessions]').textContent.includes('新的课题')`)
  await click('[data-prep-action=skills]')
  await browser.waitFor(`!!document.querySelector('#prep-skill-content')`)
  await browser.evaluate(`document.querySelector('#prep-skill-name').value='项目教学';document.querySelector('#prep-skill-content').value=${JSON.stringify('# Teaching\nUse clear objectives.')};__skillFailure=true;document.querySelector('[data-dialog-submit]').click()`)
  await browser.waitFor(`document.querySelector('.prep-modal-error')?.textContent.includes('保存暂时失败')`)
  await check('a failed skill save preserves editable content and allows retry', `document.querySelector('#prep-skill-content').value.includes('clear objectives') && !document.querySelector('[data-dialog-submit]').disabled`)
  await browser.evaluate(`__skillFailure=false;document.querySelector('[data-dialog-submit]').click()`)
  await browser.waitFor(`!!document.querySelector('[data-skill-delete]')`)
  await check('teachers can upload their own skill text without a model credential form', `document.querySelector('[data-prep-skills]').textContent.includes('项目教学') && !document.querySelector('input[type=password]')`)
  await click('[data-skill-delete=skill1]')
  await browser.waitFor(`!document.querySelector('[data-skill-delete]')`)
  await key('Escape')
  await browser.waitFor(`!document.querySelector('.prep-modal')`)
  await check('closing the native modal returns focus to the triggering control', `!document.querySelector('.prep-modal') && document.activeElement.matches('[data-prep-action=skills]')`)

  await browser.evaluate(`__deferS1=true;void __prepTest.openSession('s1')`)
  await browser.waitFor(`typeof __finishS1==='function'`)
  await browser.evaluate(`__prepTest.openSession('s2')`)
  await browser.waitFor(`document.querySelector('[data-prep-title]').textContent==='第二个独立对话'`)
  await browser.evaluate(`__finishS1();__deferS1=false`)
  await check('late responses from a prior conversation cannot overwrite the open one', `document.querySelector('[data-prep-title]').textContent==='第二个独立对话' && !document.querySelector('[data-prep-proposal]')`)

  await browser.evaluate(`__details.s2.events=[{id:31,type:'status',data:{status:'completed',message:'第一页'}}];__details.s2.hasMore=true;__eventPages=[{events:[{id:32,type:'reasoning',data:{text:'第二页的真实推理'}}],hasMore:true},{events:[{id:33,type:'status',data:{status:'completed',message:'末页已同步'}}],hasMore:false}];void __prepTest.openSession('s2')`)
  await browser.waitFor(`document.querySelector('[data-prep-events]')?.textContent.includes('末页已同步')`)
  await check('completed conversations drain all event pages without needing an active run', `document.querySelector('[data-prep-events]').textContent.includes('第二页的真实推理') && __requests.some(r=>r.p.endsWith('/s2/events')) && !__details.s2.hasMore`)

  await browser.evaluate(`void __prepTest.openSession('')`)
  await browser.waitFor(`!!document.querySelector('.prep-welcome')`)
  await browser.evaluate(`document.querySelector('#prep-message').value='教师一尚未发送的私密材料';document.querySelector('#prep-message').dispatchEvent(new Event('input',{bubbles:true}));__owner='teacher2';__deferStatus=true;__prepTest.mount('')`)
  await browser.waitFor(`typeof __finishStatus==='function'`)
  await check('drafts stay hidden until the current account identity is verified', `document.querySelector('#prep-message').value==='' && document.querySelector('#prep-message').disabled && !document.querySelector('[data-prep-root]').textContent.includes('教师一尚未发送')`)
  await browser.evaluate(`__finishStatus();__deferStatus=false`)
  await browser.waitFor(`!document.querySelector('#prep-message').disabled`)
  await check('switching teacher accounts clears the previous account unsent draft', `document.querySelector('#prep-message').value==='' && !document.querySelector('.prep-upload')`)
  await browser.evaluate(`__owner='teacher1';__prepTest.mount('')`)
  await browser.waitFor(`!document.querySelector('[data-prep-action=new]').disabled`)
  await check('a prior account draft cannot reappear after switching back', `document.querySelector('#prep-message').value===''`)

  for(const [width,height] of [[320,740],[390,844],[768,1024],[1366,768]]){
    await browser.setViewport(width,height,{mobile:width<1024})
    for(const theme of ['light','dark']){
      await browser.evaluate(`document.documentElement.classList.toggle('dark',${theme==='dark'})`)
      await check(`preparation layout fits ${width}px ${theme}`, `document.documentElement.scrollWidth<=${width}+1 && document.querySelector('.prep-layout').getBoundingClientRect().right<=${width}+1 && [...document.querySelectorAll('.prep-chat :is(button,textarea)')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().right<=${width}+1)`)
    }
  }
  await browser.setViewport(390,844,{mobile:true})
  await click('[data-prep-panel=activity]')
  await check('mobile work panels expose the selected state and fit touch targets', `document.querySelector('[data-prep-panel=activity]').getAttribute('aria-selected')==='true' && getComputedStyle(document.querySelector('.prep-activity')).display!=='none' && [...document.querySelectorAll('[data-prep-panel]')].every(e=>e.getBoundingClientRect().height>=44)`)
  await browser.evaluate(`document.querySelector('[data-prep-panel=activity]').focus()`)
  await key('Home')
  await check('mobile panel tabs support keyboard movement and focus', `document.activeElement.matches('[data-prep-panel=sessions]') && document.activeElement.getAttribute('aria-selected')==='true'`)
  await browser.evaluate(`__enabled=false;__prepTest.mount('s2')`)
  await browser.waitFor(`!document.querySelector('[data-prep-disabled]').hidden`)
  await check('an unconfigured runtime is clearly disabled without simulated AI activity', `document.querySelector('[data-prep-send]').disabled && document.querySelector('[data-prep-disabled]').textContent.includes('尚未启用') && !document.querySelector('[data-prep-stream]')`)
  if(process.env.E2E_OUTPUT){mkdirSync(process.env.E2E_OUTPUT,{recursive:true});await browser.screenshot(process.env.E2E_OUTPUT+'/prep-phone.png')}
  console.log(`智能备课组件验收 ${passed}/${passed} 通过`)
} finally { await browser.close() }
