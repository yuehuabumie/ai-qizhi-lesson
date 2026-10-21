/** Isolated preparation UI regressions. Mocked API only; no accounts or business writes. */
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'
import { prepBrowserSource } from './lib/prep-browser-source.mjs'

const source = prepBrowserSource()
  .replace('  boot().catch((e) =>', '  Promise.resolve().catch((e) =>')
  .replace(/\}\)\(\)\s*$/, `
    globalThis.__prepTest = { mount(id='') {mountPage({$el:null},id)}, openSession, poll, unmountPage };
  })()`)
const lessonMarkdown = `## 科学探究教案

请**核对名单**，再确认创建。

- 观察现象
- 记录结果

> 让每位学生先独立思考。

| 环节 | 时间 |
| --- | --- |
| 实验 | 10 分钟 |

\`\`\`js
const sample = '<img onerror="window.__markdownXss=1">';
\`\`\`

[课程资料](https://example.edu/lesson) [危险地址](javascript:alert(1))

<img src=x onerror="window.__markdownXss=1">`
const css = readFileSync(new URL('../site/assets/index-D-SlqVZT.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('./responsive-shell.js', import.meta.url), 'utf8')
const browser = await launch()
let passed = 0
const output = process.env.E2E_OUTPUT
if(output) mkdirSync(output,{recursive:true})
async function settleTransitions(){await browser.evaluate(`Promise.allSettled(document.getAnimations().map(a=>a.finished))`)}
async function phoneShots(name,{panel='chat',scrollTo='',openDetails=false}={}){
  if(!output)return
  await browser.waitFor(`!document.querySelector('.prep-toast:not([hidden])')`)
  const before=await browser.evaluate(`({width:innerWidth,height:innerHeight,dark:document.documentElement.classList.contains('dark'),panel:document.querySelector('[data-prep-root]').dataset.panel,threadTop:document.querySelector('[data-prep-thread]').scrollTop})`)
  for(const [width,height] of [[320,740],[390,844]]){
    await browser.setViewport(width,height,{mobile:true})
    await browser.evaluate(`(()=>{document.documentElement.classList.remove('dark');document.querySelector('[data-prep-panel="${panel}"]').click();window.scrollTo(0,0);document.querySelector('[data-prep-thread]').scrollTop=0;const modal=document.querySelector('.prep-modal');if(modal)modal.scrollTop=0;${openDetails?`document.querySelectorAll('[data-prep-events] details').forEach(e=>e.open=true);`:''}${scrollTo?`document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});`:''}document.querySelectorAll('.prep-layout,.prep-chat,.prep-wrap').forEach(e=>e.scrollTop=0)})()`)
    await settleTransitions()
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=${width}+1`),`screenshot ${name} has no ${width}px horizontal overflow`)
    await browser.screenshot(`${output}/${name}-${width}.png`)
  }
  await browser.setViewport(before.width,before.height,{mobile:before.width<1024})
  await browser.evaluate(`document.documentElement.classList.toggle('dark',${before.dark});document.querySelector('[data-prep-panel="${before.panel}"]').click();document.querySelector('[data-prep-thread]').scrollTop=${before.threadTop}`)
}
async function check(name, expression) { assert.ok(await browser.evaluate(expression), name); console.log(`PASS ${name}`); passed++ }
async function click(selector) { await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).click()`) }
async function key(name, modifiers=0) { await browser.page.send('Input.dispatchKeyEvent',{type:'keyDown',key:name,modifiers,windowsVirtualKeyCode:name==='Escape'?27:name==='Tab'?9:undefined}); await browser.page.send('Input.dispatchKeyEvent',{type:'keyUp',key:name}) }
async function enter(shift=false) {
  const modifiers=shift?8:0
  const base={key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,modifiers}
  await browser.page.send('Input.dispatchKeyEvent',{...base,type:'keyDown',text:'\r',unmodifiedText:'\r'})
  await browser.page.send('Input.dispatchKeyEvent',{...base,type:'keyUp'})
}
try {
  await browser.evaluate(`
    document.head.innerHTML='<meta name="viewport" content="width=device-width, initial-scale=1">';
    let fixtureUuid=0;crypto.randomUUID ||= ()=>'fixture-'+(++fixtureUuid);
    document.body.innerHTML='<div id="app"><header class="aiq-navbar"><nav><a href="#/teach" class="nav-item">课堂教学</a></nav><div class="el-drawer__body"><div><a href="#/teach">课堂教学</a></div></div></header><main></main></div>';
    const base=document.createElement('style');base.textContent=${JSON.stringify(css)};document.head.append(base);
    ${responsive};
    window.__reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    window.__sessions=[{id:'s1',title:'科学探究课',status:'completed',updatedAt:'2026-10-21T00:00:00Z'},{id:'s2',title:'第二个独立对话',status:'completed',updatedAt:'2026-10-21T00:00:00Z'}];
    window.__details={
      s1:{session:__sessions[0],messages:[
        {id:'u1',role:'user',runId:'r-class1',content:'<img src=x onerror="window.__xss=1">教材',attachmentIds:[],createdAt:'2026-10-21T00:00:00Z'},
        {id:'a1',role:'assistant',runId:'r-class1',content:${JSON.stringify(lessonMarkdown)},attachmentIds:[],createdAt:'2026-10-21T00:00:30Z'},
        {id:'u2',role:'user',runId:'r-class2',content:'再检查一次班级',attachmentIds:[],createdAt:'2026-10-21T00:01:00Z'},
        {id:'a2',role:'assistant',runId:'r-class2',content:'第二轮总结：已检查班级。',attachmentIds:[],createdAt:'2026-10-21T00:01:10Z'}
      ],events:[
        {id:1,runId:'r-class1',type:'text',createdAt:'2026-10-21T00:00:01Z',data:{text:'我先核对班级名单。'}},
        {id:2,runId:'r-class1',type:'reasoning',createdAt:'2026-10-21T00:00:02Z',data:{text:'先读取材料，核对同名与学号。'}},
        {id:3,runId:'r-class1',type:'tool-start',createdAt:'2026-10-21T00:00:03Z',data:{name:'create_class',callId:'call1',input:{name:'三年一班'}}},
        {id:4,runId:'r-class1',type:'tool-result',createdAt:'2026-10-21T00:00:04Z',data:{name:'create_class',callId:'call1',output:{message:'等待确认 <img onerror=x>'}}},
        {id:5,runId:'r-class1',type:'text',createdAt:'2026-10-21T00:00:29Z',data:{text:${JSON.stringify(lessonMarkdown)}}},
        {id:6,runId:'r-class2',type:'tool-start',createdAt:'2026-10-21T00:01:01Z',data:{name:'list_classes',callId:'call1',input:{}}},
        {id:7,runId:'r-class2',type:'tool-result',createdAt:'2026-10-21T00:01:02Z',data:{name:'list_classes',callId:'call1',output:{message:'第二轮的班级结果'}}},
        {id:8,runId:'r-class2',type:'text',createdAt:'2026-10-21T00:01:09Z',data:{text:'第二轮总结：已检查班级。'}}
      ],attachments:[{id:'f1',runId:'r-class1',createdAt:'2026-10-21T00:00:28Z',name:'科学教案.docx',mime:'application/octet-stream',size:1024,kind:'artifact'}],proposals:[{id:'p1',runId:'r-class1',createdAt:'2026-10-21T00:00:27Z',tool:'create_class',description:'创建三年一班',version:'v1',status:'pending',payload:{name:'三年一班',members:[{name:'张三',studentNo:'001',gender:null,score:null}]},preview:{className:'三年一班',members:[{name:'张三',studentNo:'001',gender:null,score:null}]}}],activeRun:null},
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
        if(part==='messages'){const id='user'+__requests.length;detail.messages.push({id,role:'user',runId:'r1',content:body.content,attachmentIds:body.attachmentIds,createdAt:new Date().toISOString()});detail.activeRun={id:'r1',messageId:id,status:'queued',createdAt:new Date().toISOString()};return __reply({runId:'r1',status:'queued'});}
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
    __prepTest.mount('s1');
  `)
  await browser.waitFor(`document.querySelector('[data-prep-title]')?.textContent==='科学探究课' && !document.querySelector('[data-prep-action=new]').disabled`)
  await check('untrusted conversation content is text rather than executable markup', `!window.__xss && !document.querySelector('[data-prep-thread] img') && document.querySelector('[data-prep-thread]').textContent.includes('<img src=x')`)
  await check('assistant Markdown renders headings, lists, emphasis, tables, quotes and fenced code', `(()=>{const m=document.querySelector('[data-prep-message="a1"]');return m.querySelector('h2')?.textContent==='科学探究教案' && m.querySelector('strong')?.textContent==='核对名单' && m.querySelectorAll('ul li').length===2 && m.querySelector('blockquote')?.textContent.includes('独立思考') && m.querySelector('table th')?.textContent==='环节' && m.querySelector('pre code')?.textContent.includes('const sample')})()`)
  await check('Markdown preserves safe links and keeps raw HTML and dangerous URLs inert', `(()=>{const m=document.querySelector('[data-prep-message="a1"]');return !window.__markdownXss && !m.querySelector('img,script,iframe,[onerror],[onclick]') && ![...m.querySelectorAll('a')].some(a=>/^(?:javascript|data|vbscript):/i.test(a.getAttribute('href')||'')) && [...m.querySelectorAll('a')].some(a=>a.getAttribute('href')==='https://example.edu/lesson') && m.textContent.includes('<img src=x')})()`)
  await check('actual reasoning is available as a collapsed disclosure', `document.querySelector('.prep-reasoning')?.textContent.includes('先读取材料') && !document.querySelector('.prep-reasoning').open`)
  await check('the workspace has only conversation navigation and chat with work events inline', `document.querySelectorAll('.prep-layout>aside').length===1 && !document.querySelector('.prep-activity,[data-prep-panel="activity"]') && document.querySelectorAll('[data-prep-thread] [data-prep-events]').length===2`)
  await check('tool results are paired within their own run and escaped even when call ids repeat', `(()=>{const first=document.querySelector('[data-prep-run="r-class1"]'),second=document.querySelector('[data-prep-run="r-class2"]');return first.querySelectorAll('details.prep-tool-event').length===1 && first.textContent.includes('<img onerror=x>') && !first.querySelector('img') && !first.textContent.includes('第二轮的班级结果') && second.textContent.includes('第二轮的班级结果') && !second.textContent.includes('等待确认')})()`)
  await check('completed runs retain intermediate updates without duplicating the final reply', `document.querySelector('[data-prep-run="r-class1"] [data-prep-progress]')?.textContent.includes('我先核对班级名单。') && document.querySelectorAll('[data-prep-thread] h2').length===1 && [...document.querySelectorAll('[data-prep-progress]')].every(e=>!e.textContent.includes('第二轮总结：')) && document.querySelectorAll('[data-prep-final]').length===2`)
  await check('generated files remain downloadable within their conversation', `(()=>{const card=document.querySelector('[data-prep-thread] [data-prep-artifact="f1"]');return card?.textContent.includes('科学教案.docx') && card.querySelector('a.is-artifact')?.getAttribute('href')==='/api/prep/attachments/f1' && card.querySelector('a.is-artifact').textContent.includes('下载') && !document.querySelector('[data-prep-artifacts]')})()`)
  await check('the generated file button sits directly below the new conversation action', `(()=>{const files=document.querySelector('[data-prep-action="files"]'),create=document.querySelector('[data-prep-action="new"]');return files?.textContent.includes('查看已生成文件') && files.closest('.prep-sidebar')===create.closest('.prep-sidebar') && files.getBoundingClientRect().top>=create.getBoundingClientRect().bottom})()`)
  await check('user messages align to the right with their avatar after the message bubble', `(()=>{const u=document.querySelector('[data-prep-message="u1"]'),body=u.querySelector('.prep-message-body').getBoundingClientRect(),avatar=u.querySelector('.prep-message-avatar').getBoundingClientRect(),run=document.querySelector('[data-prep-run="r-class1"]');return body.right<=avatar.left && u.getBoundingClientRect().right>=run.getBoundingClientRect().right-1})()`)
  await check('message input has a visible label and a persistent border', `(()=>{const input=document.querySelector('#prep-message'),style=getComputedStyle(input),label=document.querySelector('label[for="prep-message"]');return label && label.getBoundingClientRect().height>0 && getComputedStyle(label).position!=='absolute' && parseFloat(style.borderTopWidth)>=1 && style.borderTopStyle!=='none' && style.borderTopColor!=='rgba(0, 0, 0, 0)'})()`)
  await check('classroom-changing actions stay in the corresponding run and require confirmation', `document.querySelector('[data-prep-run="r-class1"] [data-prep-proposal="p1"] [data-prep-confirm=p1]')?.textContent==='确认执行' && !document.querySelector('[data-prep-run="r-class2"] [data-prep-proposal="p1"]') && !__requests.some(r=>r.p.endsWith('/confirm'))`)
  await click('[data-prep-action=files]')
  await browser.waitFor(`!!document.querySelector('.prep-files-modal[open]')`)
  await check('the file modal provides explicit private download controls for the open conversation', `(()=>{const cards=[...document.querySelectorAll('.prep-files-modal [data-prep-artifact]')];return cards.length===1 && cards[0].dataset.prepArtifact==='f1' && cards[0].textContent.includes('科学教案.docx') && cards[0].querySelector('a.is-artifact')?.getAttribute('href')==='/api/prep/attachments/f1' && cards[0].querySelector('a.is-artifact').textContent.includes('下载') && document.querySelector('.prep-files-modal [data-prep-artifacts]')})()`)
  await phoneShots('prep-files-modal',{panel:'sessions',scrollTo:'.prep-files-modal'})
  await browser.evaluate(`__details.s1.attachments.push({id:'f2',runId:'r-class1',createdAt:'2026-10-21T00:00:29Z',name:'课堂讲义.pdf',mime:'application/pdf',size:2048,kind:'artifact'},{id:'uploaded-material',name:'教师上传的教材.pdf',mime:'application/pdf',size:1024,kind:'upload'});void __prepTest.poll()`)
  await browser.waitFor(`!!document.querySelector('.prep-files-modal [data-prep-artifact="f2"]')`)
  await check('an open file list refreshes when a generated artifact arrives and excludes uploads', `document.querySelectorAll('.prep-files-modal [data-prep-artifact]').length===2 && document.querySelector('[data-prep-thread] [data-prep-artifact="f2"]') && !document.querySelector('.prep-files-modal').textContent.includes('教师上传的教材')`)
  await browser.evaluate(`__details.s1.attachments=__details.s1.attachments.filter(a=>a.id==='f1');void __prepTest.poll()`)
  await browser.waitFor(`document.querySelectorAll('.prep-files-modal [data-prep-artifact]').length===1`)
  await key('Escape')
  await browser.waitFor(`!document.querySelector('.prep-modal')`)
  await check('closing the file modal returns focus to its navigation button', `document.activeElement.matches('[data-prep-action="files"]')`)
  const normalViewport=await browser.evaluate(`({width:innerWidth,height:innerHeight})`)
  await browser.setViewport(1366,900,{mobile:false})
  await browser.evaluate(`window.__fullBefore={bodyOverflow:document.body.style.overflow,documentOverflow:document.documentElement.style.overflow,appInert:document.querySelector('#app').inert};document.querySelector('#prep-message').value='保留尚未发送的备课草稿';document.querySelector('#prep-message').dispatchEvent(new Event('input',{bubbles:true}))`)
  await click('[data-prep-action=fullscreen]')
  await check('fullscreen fills the desktop viewport and isolates background app controls', `(()=>{const r=document.querySelector('[data-prep-root]'),bounds=r.getBoundingClientRect();return r.classList.contains('is-fullscreen') && r.parentElement===document.body && document.querySelector('[data-prep-action="fullscreen"]').getAttribute('aria-pressed')==='true' && Math.abs(bounds.x)<=1 && Math.abs(bounds.y)<=1 && Math.abs(bounds.width-innerWidth)<=1 && Math.abs(bounds.height-innerHeight)<=1 && document.querySelector('#app').inert})()`)
  if(output){await settleTransitions();await browser.screenshot(output+'/prep-fullscreen-1366.png')}
  for(const [width,height] of [[320,740],[390,844],[360,480]]){
    await browser.setViewport(width,height,{mobile:true})
    await check(`fullscreen keeps the conversation draft and input usable at ${width}x${height}`, `(()=>{const r=document.querySelector('[data-prep-root]').getBoundingClientRect(),input=document.querySelector('#prep-message').getBoundingClientRect(),send=document.querySelector('[data-prep-send]').getBoundingClientRect();return Math.abs(r.x)<=1 && Math.abs(r.y)<=1 && Math.abs(r.width-innerWidth)<=1 && Math.abs(r.height-innerHeight)<=1 && document.documentElement.scrollWidth<=innerWidth+1 && input.top>=0 && input.bottom<=innerHeight+1 && send.top>=0 && send.bottom<=innerHeight+1 && document.querySelector('[data-prep-thread]').clientHeight>0 && document.querySelector('#prep-message').value==='保留尚未发送的备课草稿' && document.querySelector('[data-prep-message="a1"]')})()`)
    if(output){await settleTransitions();await browser.screenshot(output+'/prep-fullscreen-'+width+'x'+height+'.png')}
  }
  await click('[data-prep-panel=sessions]')
  await click('[data-prep-action=files]')
  await browser.waitFor(`!!document.querySelector('.prep-files-modal[open]')`)
  await key('Escape')
  await browser.waitFor(`!document.querySelector('.prep-files-modal')`)
  await check('Escape dismisses an open modal before leaving fullscreen', `document.querySelector('[data-prep-root]').classList.contains('is-fullscreen') && document.querySelector('#app').inert`)
  await key('Escape')
  await check('leaving fullscreen restores app access and keeps the unsent draft', `(()=>{const root=document.querySelector('[data-prep-root]');return !root.classList.contains('is-fullscreen') && document.querySelector('#app main').contains(root) && document.querySelector('[data-prep-action="fullscreen"]').getAttribute('aria-pressed')==='false' && document.querySelector('#app').inert===__fullBefore.appInert && document.body.style.overflow===__fullBefore.bodyOverflow && document.documentElement.style.overflow===__fullBefore.documentOverflow && document.querySelector('#prep-message').value==='保留尚未发送的备课草稿'})()`)
  await browser.setViewport(normalViewport.width,normalViewport.height,{mobile:normalViewport.width<1024})
  await browser.evaluate(`document.querySelector('[data-prep-panel="chat"]').click();document.querySelector('#prep-message').value='';document.querySelector('#prep-message').dispatchEvent(new Event('input',{bubbles:true}))`)
  await phoneShots('prep-conversation',{panel:'chat',scrollTo:'.prep-chat'})
  await phoneShots('prep-reasoning-tools',{panel:'chat',scrollTo:'[data-prep-events]',openDetails:true})
  await phoneShots('prep-markdown',{panel:'chat',scrollTo:'[data-prep-final="a1"]'})
  await phoneShots('prep-markdown-table-code',{panel:'chat',scrollTo:'[data-prep-final="a1"] table'})
  await phoneShots('prep-generated-file',{panel:'chat',scrollTo:'[data-prep-thread] [data-prep-artifact="f1"]'})
  await phoneShots('prep-proposal-inline',{panel:'chat',scrollTo:'[data-prep-proposal="p1"]'})
  if(output){
    await browser.setViewport(1366,900,{mobile:false})
    await browser.evaluate(`document.documentElement.classList.add('dark');document.querySelector('[data-prep-panel="chat"]').click();document.querySelector('[data-prep-final="a1"]').scrollIntoView({block:'start'});document.querySelectorAll('.prep-layout,.prep-chat,.prep-wrap').forEach(e=>e.scrollTop=0);window.scrollTo(0,0)`)
    await settleTransitions()
    await browser.screenshot(output+'/prep-desktop-dark.png')
    await browser.evaluate(`document.documentElement.classList.remove('dark')`)
    await settleTransitions()
    await browser.screenshot(output+'/prep-desktop-light.png')
  }

  await click('[data-prep-edit=p1]')
  await browser.waitFor(`!!document.querySelector('.prep-modal[open]')`)
  await phoneShots('prep-proposal-edit',{panel:'chat'})
  await phoneShots('prep-proposal-edit-actions',{panel:'chat',scrollTo:'.prep-modal-foot'})
  await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('[data-editor-path]')].find(e=>e.dataset.editorPath==='["members",0,"name"]');e.value='李四';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-dialog-submit]').click()})()`)
  await browser.waitFor(`!document.querySelector('.prep-modal') && document.querySelector('[data-prep-proposal="p1"]').textContent.includes('李四')`)
  await check('editing a proposal submits its reviewed version and produces a fresh preview', `__patched.version==='v1' && __patched.payload.members[0].name==='李四' && !__requests.some(r=>r.p.endsWith('/confirm'))`)
  await browser.evaluate(`__confirmConflict=true`)
  await click('[data-prep-confirm=p1]')
  await browser.waitFor(`document.querySelector('[data-prep-error]').textContent.includes('预览已更新')`)
  await check('version conflicts require review of the new preview', `!!document.querySelector('[data-prep-confirm=p1]') && !document.querySelector('[data-prep-confirm=p1]').disabled && !window.__confirmed`)
  await click('[data-prep-confirm=p1]')
  await browser.waitFor(`document.querySelector('[data-prep-proposal="p1"]').textContent.includes('已执行')`)
  await check('confirmation is bound to the latest server-provided version', `__confirmed.version==='v3' && !document.querySelector('[data-prep-confirm=p1]')`)

  await browser.evaluate(`__prepTest.openSession('')`)
  await browser.waitFor(`document.querySelector('.prep-welcome')`)
  await check('a new conversation starts without previous messages or file context', `!document.querySelector('[data-prep-message]') && !document.querySelector('.is-artifact') && document.querySelector('#prep-message').value===''`)
  await click('[data-prep-action=files]')
  await browser.waitFor(`!!document.querySelector('.prep-files-modal[open]')`)
  await check('a fresh conversation file list is empty and cannot reveal prior artifacts', `!document.querySelector('.prep-files-modal [data-prep-artifact]') && !document.querySelector('.prep-files-modal').textContent.includes('科学教案.docx')`)
  await browser.evaluate(`void __prepTest.openSession('s2')`)
  await browser.waitFor(`document.querySelector('[data-prep-title]').textContent==='第二个独立对话'`)
  await check('switching conversations dismisses a file modal before displaying the new context', `!document.querySelector('.prep-files-modal') && !document.querySelector('[data-prep-artifact]')`)
  await browser.evaluate(`void __prepTest.openSession('')`)
  await browser.waitFor(`!!document.querySelector('.prep-welcome')`)
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
  await browser.evaluate(`__details.new1.activeRun.status='running';__details.new1.events=[{id:10,runId:'r1',type:'reasoning',data:{text:'已读取三份资料。'}},{id:11,runId:'r1',type:'text',data:{text:'我已整理出'}},{id:12,runId:'r1',type:'text',data:{text:'第一版。'}},{id:13,runId:'r1',type:'tool-start',data:{name:'write',callId:'write1',input:{path:'lesson.md'}}},{id:14,runId:'r1',type:'tool-result',data:{name:'write',callId:'write1',output:{ok:true}}},{id:15,runId:'r1',type:'text',data:{text:'正在补充'}},{id:16,runId:'r1',type:'text',data:{text:'课堂活动。'}}];__prepTest.poll()`)
  await browser.waitFor(`document.querySelector('[data-prep-stream]')?.textContent.includes('我已整理出')`)
  await check('incremental provider events become reasoning and response content', `document.querySelector('[data-prep-events]').textContent.includes('已读取三份资料') && document.querySelector('[data-prep-run-status]').textContent==='正在备课'`)
  await check('stream token deltas join continuously and work updates form separate paragraphs', `(()=>{const blocks=[...document.querySelectorAll('[data-prep-run="r1"] [data-prep-progress]')];return blocks.length===2 && blocks[0].textContent.trim()==='我已整理出第一版。' && blocks[1].textContent.trim()==='正在补充课堂活动。' && getComputedStyle(blocks[0]).display!=='inline' && blocks[0].getBoundingClientRect().bottom<blocks[1].getBoundingClientRect().top})()`)
  await browser.evaluate(`document.querySelector('[data-prep-run="r1"] .prep-reasoning').open=true;__details.new1.events.push({id:17,runId:'r1',type:'text',data:{text:'即将完成。'}});void __prepTest.poll()`)
  await browser.waitFor(`document.querySelector('[data-prep-run="r1"] [data-prep-progress]:last-of-type')?.textContent.includes('即将完成') || [...document.querySelectorAll('[data-prep-run="r1"] [data-prep-progress]')].some(e=>e.textContent.includes('即将完成'))`)
  await check('live updates preserve the teacher opened reasoning disclosure', `document.querySelector('[data-prep-run="r1"] .prep-reasoning').open && [...document.querySelectorAll('[data-prep-progress]')].at(-1).textContent.trim()==='正在补充课堂活动。即将完成。'`)
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
  await check('completed conversations drain all event pages without needing an active run', `[...document.querySelectorAll('[data-prep-thread] [data-prep-events]')].some(e=>e.textContent.includes('第二页的真实推理')) && __requests.some(r=>r.p.endsWith('/s2/events')) && !__details.s2.hasMore`)

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

  await browser.evaluate(`void __prepTest.openSession('s1')`)
  await browser.waitFor(`!!document.querySelector('[data-prep-final="a1"] table')`)

  for(const [width,height] of [[320,740],[390,844],[768,1024],[1366,768]]){
    await browser.setViewport(width,height,{mobile:width<1024})
    for(const theme of ['light','dark']){
      await browser.evaluate(`document.documentElement.classList.toggle('dark',${theme==='dark'})`)
      await settleTransitions()
      await check(`preparation layout fits ${width}px ${theme}`, `document.documentElement.scrollWidth<=${width}+1 && document.querySelector('.prep-layout').getBoundingClientRect().right<=${width}+1 && (innerWidth>=640 || getComputedStyle(document.querySelector('.prep-sidebar')).display==='none') && [...document.querySelectorAll('.prep-chat :is(button,textarea)')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().right<=${width}+1)`)
      await check(`Markdown and generated files remain bounded at ${width}px ${theme}`, `(()=>{const thread=document.querySelector('[data-prep-thread]').getBoundingClientRect();return [...document.querySelectorAll('[data-prep-thread] :is(table,pre,.prep-artifact-card)')].every(e=>e.getBoundingClientRect().right<=thread.right+1) && document.querySelector('[data-prep-thread] [data-prep-artifact="f1"] a.is-artifact').getBoundingClientRect().height>=44})()`)
      await check(`download controls and Markdown links retain readable contrast at ${width}px ${theme}`, `(()=>{
        const rgb=value=>(value.match(/[\\d.]+/g)||[]).map(Number);
        const lum=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        function background(el){for(let p=el;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length===3||c[3]>=.99)return c}return [255,255,255]}
        return [...document.querySelectorAll('a.is-artifact,.prep-heading-actions>.prep-btn,[data-prep-action="skills"],.prep-markdown a')].every(el=>{const colors=[lum(rgb(getComputedStyle(el).color)),lum(background(el))].sort((a,b)=>b-a);return (colors[0]+.05)/(colors[1]+.05)>=4.5})
      })()`)
    }
  }
  await browser.setViewport(390,844,{mobile:true})
  await click('[data-prep-panel=sessions]')
  await check('mobile has only chat and conversation navigation with accessible file access', `document.querySelectorAll('[data-prep-panel]').length===2 && document.querySelector('[data-prep-panel=sessions]').getAttribute('aria-selected')==='true' && getComputedStyle(document.querySelector('.prep-sidebar')).display!=='none' && document.querySelector('[data-prep-action="files"]').getBoundingClientRect().height>=44 && [...document.querySelectorAll('[data-prep-panel]')].every(e=>e.getBoundingClientRect().height>=44)`)
  await browser.evaluate(`document.querySelector('[data-prep-panel=chat]').focus()`)
  await key('Home')
  await check('mobile panel tabs support keyboard movement and focus', `document.activeElement.matches('[data-prep-panel=sessions]') && document.activeElement.getAttribute('aria-selected')==='true'`)
  await click('[data-prep-panel=chat]')
  await click('[data-prep-action=fullscreen]')
  await browser.evaluate(`__prepTest.unmountPage()`)
  await check('route unmount while fullscreen restores the host app and document scrolling', `!document.querySelector('[data-prep-root]') && document.querySelector('#app').inert===__fullBefore.appInert && document.body.style.overflow===__fullBefore.bodyOverflow && document.documentElement.style.overflow===__fullBefore.documentOverflow`)
  await browser.setViewport(1366,900,{mobile:false})
  await browser.evaluate(`__enabled=true;__owner='teacher1';__deferStatus=false;__details.s2.activeRun=null;__details.s2.messages=[];__details.s2.attachments=[];__prepTest.mount('s2')`)
  await browser.waitFor(`document.querySelector('[data-prep-title]')?.textContent==='第二个独立对话' && !document.querySelector('#prep-message').disabled`)
  await check('the composer explains Enter sends and Shift+Enter adds a line break', `document.querySelector('#prep-input-help').textContent.includes('Enter 发送') && document.querySelector('#prep-input-help').textContent.includes('Shift+Enter 换行')`)
  await browser.evaluate(`(()=>{const t=document.querySelector('#prep-message');window.__keyBefore=__requests.filter(r=>r.p.endsWith('/messages')).length;t.value='第一行';t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();t.setSelectionRange(3,3)})()`)
  await enter(true)
  await browser.waitFor(`document.querySelector('#prep-message').value==='第一行\\n'`)
  await check('Shift+Enter inserts a newline without sending', `__requests.filter(r=>r.p.endsWith('/messages')).length===window.__keyBefore && document.querySelector('#prep-message').value==='第一行\\n'`)
  await browser.evaluate(`(()=>{const t=document.querySelector('#prep-message');window.__composeBefore=__requests.filter(r=>r.p.endsWith('/messages')).length;window.__composeNotPrevented=t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true}))})()`)
  await browser.evaluate(`new Promise(r=>setTimeout(r,80))`)
  await check('Enter during IME composition is left to the input method', `window.__composeNotPrevented===true && __requests.filter(r=>r.p.endsWith('/messages')).length===window.__composeBefore`)
  await browser.evaluate(`(()=>{const t=document.querySelector('#prep-message');t.value='回车发送测试';t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();t.setSelectionRange(t.value.length,t.value.length);window.__enterBefore=__requests.filter(r=>r.p.endsWith('/messages')).length})()`)
  await enter(false)
  await browser.waitFor(`document.querySelector('#prep-message').value==='' && __details.s2.messages.some(m=>m.content==='回车发送测试')`)
  await check('Enter sends the message without adding a newline', `__requests.filter(r=>r.p.endsWith('/messages')).length===window.__enterBefore+1 && __details.s2.messages.at(-1).content==='回车发送测试'`)
  await browser.evaluate(`__enabled=false;__details.s2.activeRun=null;__details.s2.messages=[];__details.s2.events=[];__prepTest.mount('s2')`)
  await browser.waitFor(`!document.querySelector('[data-prep-disabled]').hidden`)
  await check('an unconfigured runtime is clearly disabled without simulated AI activity', `document.querySelector('[data-prep-send]').disabled && document.querySelector('[data-prep-disabled]').textContent.includes('尚未启用') && !document.querySelector('[data-prep-stream]')`)
  if(process.env.E2E_OUTPUT){mkdirSync(process.env.E2E_OUTPUT,{recursive:true});await browser.screenshot(process.env.E2E_OUTPUT+'/prep-phone.png')}
  console.log(`智能备课组件验收 ${passed}/${passed} 通过`)
} finally { await browser.close() }
