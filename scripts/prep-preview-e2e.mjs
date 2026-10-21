/** Real browser sandbox checks. The HTML below is deliberately hostile test data. */
import assert from 'node:assert/strict'
import { readFileSync,mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { launch,sleep } from './lib/cdp-kit.mjs'
import { prepBrowserSource } from './lib/prep-browser-source.mjs'
const seen=[]
const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"><main></main></div>')})
await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
const base='http://127.0.0.1:'+server.address().port
const payload=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'"><meta http-equiv="refresh" content="90;url=${base}/escape-refresh"><link rel="prefetch" href="${base}/leak-prefetch"><style>body{font:16px/1.8 system-ui,sans-serif;color:#18213a;background:#f5f7ff;margin:0;padding:20px;box-sizing:border-box}h1{font-size:22px;line-height:1.5;margin:0 0 12px}p{font-size:15px}button{display:block;min-width:96px;min-height:52px;padding:10px 24px;border:0;border-radius:12px;color:#fff;background:#4f60f6;font:600 22px system-ui}img{display:none}.note{font-size:12px;color:#69748b}</style><img src="${base}/leak-image"><h1>声音识别小实验</h1><p>点击按钮，模拟识别一次声音。观察次数怎样变化。</p><p class="note">已模拟识别次数</p><button id="counter" aria-label="模拟识别次数">0</button><script>
let n=0;document.getElementById('counter').onclick=()=>document.getElementById('counter').textContent=String(++n);
let p=false,c=false;try{parent.document.body.dataset.escaped='yes'}catch{p=true}try{document.cookie}catch{c=true}
document.body.dataset.parentBlocked=String(p);document.body.dataset.cookieBlocked=String(c);
fetch('${base}/leak-fetch').catch(()=>{});
</script>`
const source=prepBrowserSource().replace('  boot().catch((e) =>','  Promise.resolve().catch((e) =>').replace(/\}\)\(\)\s*$/,`globalThis.__previewTest={mount(){mountPage({$el:null},'preview-session')}};})()`)
const browser=await launch();let passed=0
const frameSessions=new Map()
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name);passed++}
async function click(selector){await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).click()`)}
async function child(){
  const targets=await browser.browser.send('Target.getTargets')
  for(const target of targets.targetInfos.filter(t=>t.type==='iframe')){
    if(!frameSessions.has(target.targetId))frameSessions.set(target.targetId,(await browser.browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId)
    const sessionId=frameSessions.get(target.targetId)
    const probe=await browser.browser.send('Runtime.evaluate',{expression:'!!document.querySelector("#counter")',returnByValue:true},sessionId)
    if(probe.result?.value)return async expression=>{const r=await browser.browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
    const tree=await browser.browser.send('Page.getFrameTree',{},sessionId)
    for(const nested of tree.frameTree.childFrames||[]){
      const {executionContextId}=await browser.browser.send('Page.createIsolatedWorld',{frameId:nested.frame.id,worldName:'preview-verification'},sessionId)
      const evaluate=async expression=>{const r=await browser.browser.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
      if(await evaluate('!!document.querySelector("#counter")'))return evaluate
    }
  }
  const tree=await browser.page.send('Page.getFrameTree');const wrapper=tree.frameTree.childFrames?.[0],inner=wrapper?.childFrames?.[0]
  if(!inner)return null
  const {executionContextId}=await browser.page.send('Page.createIsolatedWorld',{frameId:inner.frame.id,worldName:'preview-verification'})
  return async expression=>{const r=await browser.page.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
}
try{
  await browser.goto(base,'!!document.querySelector("main")')
  await browser.evaluate(`document.cookie='private_preview_cookie=site-only; path=/';window.fetch=async(url,options={})=>{
    const p=new URL(url,location.href).pathname;
    if(p==='/api/prep/attachments/html-fixture')return new Response(${JSON.stringify(payload)},{headers:{'content-type':'text/html'}});
    const detail={session:{id:'preview-session',title:'预览验收'},messages:[],events:[],proposals:[],attachments:[{id:'html-fixture',name:'互动计数.html',mime:'text/html',kind:'artifact',size:${Buffer.byteLength(payload)}}],activeRun:null};
    const data=p==='/api/prep/status'?{enabled:true,userId:'preview-teacher',model:'deepseek-flash',limits:{}}:p==='/api/prep/sessions'?{sessions:[detail.session]}:p==='/api/prep/skills'?{skills:[]}:detail;
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  };${source};__previewTest.mount()`)
  await browser.waitFor(`!!document.querySelector('[data-prep-preview="html-fixture"]')`)
  await browser.setViewport(320,740,{mobile:true});await click('[data-prep-panel="activity"]');await click('.prep-activity [data-prep-preview="html-fixture"]')
  await browser.waitFor(`!!document.querySelector('.prep-preview-frame')`)
  let evaluate;for(let i=0;i<50&&!evaluate;i++){evaluate=await child();if(!evaluate)await sleep(100)}
  assert.ok(evaluate,'The trusted wrapper must create the inner sandbox')
  for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('#counter')`))break;await sleep(100)}
  check('self-contained interactive HTML executes only inside its sandbox',await evaluate(`!!document.querySelector('#counter')`))
  check('sandbox blocks access to parent DOM and website cookies',await evaluate(`document.body.dataset.parentBlocked==='true'&&document.body.dataset.cookieBlocked==='true'`))
  await evaluate(`document.querySelector('#counter').click();document.querySelector('#counter').click()`)
  check('interactive controls still work',await evaluate(`document.querySelector('#counter').textContent==='2'`))
  check('preview is constrained on a 320px screen',await browser.evaluate(`document.documentElement.scrollWidth<=321&&document.querySelector('.prep-preview-modal').getBoundingClientRect().right<=321`))
  check('both frame boundaries omit same-origin permission',await browser.evaluate(`document.querySelector('.prep-preview-frame').getAttribute('sandbox')==='allow-scripts'`))
  if(process.env.E2E_OUTPUT){
    mkdirSync(process.env.E2E_OUTPUT,{recursive:true})
    for(const [width,height] of [[320,740],[390,844]]){
      await browser.setViewport(width,height,{mobile:true})
      await browser.evaluate(`document.querySelector('.prep-modal').scrollTop=0;window.scrollTo(0,0)`)
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=${width}+1`))
      await browser.screenshot(`${process.env.E2E_OUTPUT}/prep-html-preview-${width}.png`)
    }
  }
  await evaluate(`location.href=${JSON.stringify(base+'/escape-navigation')}`);await sleep(350)
  check('hostile HTML cannot fetch resources or navigate the child frame onto a server',!seen.some(p=>/leak|escape/.test(p)))
  check('preview cannot modify the website document',await browser.evaluate(`!document.body.dataset.escaped&&document.cookie.includes('private_preview_cookie=site-only')`))
  await click('[data-dialog-cancel]');await browser.waitFor(`!document.querySelector('.prep-modal')`)
  check('closing preview removes its frames and restores the triggering focus',await browser.evaluate(`!document.querySelector('iframe')&&document.activeElement.matches('[data-prep-preview="html-fixture"]')`))
  console.log(`互动网页预览验收 ${passed}/${passed} 通过`)
}finally{await browser.close();await new Promise(ok=>server.close(ok))}
