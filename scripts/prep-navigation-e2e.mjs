/** Full compiled site's navigation, with mock login and no production services. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './lib/cdp-kit.mjs'
import { prepBrowserSource } from './lib/prep-browser-source.mjs'

const site = fileURLToPath(new URL('../site/', import.meta.url))
const prep = prepBrowserSource()
const sessions=[], details=new Map()
let created=0, uploaded=0
const server = createServer(async(req, res) => {
  const url=new URL(req.url, 'http://localhost'),path = url.pathname
  if (path.startsWith('/api/')) {
    const send=(data,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))}
    const parts=path.split('/')
    if(path==='/api/prep/sessions'&&req.method==='POST'){
      const session={id:'nav'+(++created),title:'新的备课对话',updatedAt:new Date().toISOString(),status:'completed'};sessions.push(session);details.set(session.id,{session,messages:[],attachments:[],events:[],proposals:[],activeRun:null});send({session});return
    }
    if(parts[3]==='sessions'&&parts[4]){
      const detail=details.get(parts[4]);if(!detail){send({error:{message:'对话不存在'}},404);return}
      if(parts[5]==='attachments'){
        let size=0;for await(const chunk of req)size+=chunk.length
        const attachment={id:'file'+(++uploaded),name:url.searchParams.get('filename'),mime:'text/plain',size,kind:'upload',createdAt:new Date().toISOString()};detail.attachments.push(attachment);send({attachment});return
      }
      if(parts[5]==='messages'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());detail.messages.push({id:'user'+Date.now(),role:'user',...body,createdAt:new Date().toISOString()});detail.activeRun={id:'run'+Date.now(),status:'queued',createdAt:new Date().toISOString()};detail.session.status='queued';send({runId:detail.activeRun.id,status:'queued'});return
      }
      send(detail);return
    }
    const data = path === '/api/auth/me' ? { user: { id:'teacher-nav', nickname:'这是一个很长的教师昵称用于导航测试', email:'teacher@example.test', avatarHue:210, avatarUrl:null, quizBest:0 } }
      : path === '/api/prep/status' ? { enabled:true,userId:'teacher-nav',model:'deepseek-flash',limits:{} }
      : path === '/api/prep/sessions' ? {sessions}
      : { progress:[],sessions:[],works:[],total:0,stats:{},quizBest:0 }
    res.writeHead(200, {'content-type':'application/json'});res.end(JSON.stringify(data));return
  }
  if(path==='/assets/prep-studio.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(prep);return}
  const file=resolve(site,'.'+decodeURIComponent(path==='/'?'/index.html':path))
  if(!file.startsWith(site.endsWith(sep)?site:site+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return}
  const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'}
  res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(readFileSync(file))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const browser=await launch()
let passed=0
try {
  await browser.goto(base+'/#/',`document.querySelectorAll('header.aiq-navbar nav a').length===10 && document.querySelector('header.aiq-navbar').textContent.includes('这是一个很长')`)
  for(const width of [1024,1100,1152,1200,1279,1280,1366,1440,1535]){
    await browser.setViewport(width,900,{mobile:false})
    const m=await browser.evaluate(`(()=>{const h=document.querySelector('header.aiq-navbar'),n=h.querySelector('nav'),nr=n.getBoundingClientRect(),links=[...n.querySelectorAll('a')].map(a=>{const r=a.getBoundingClientRect();return {text:a.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom}});const controls=[...h.querySelectorAll('button,.el-select')].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom}});const logo=h.querySelector('a[href="#/"]')?.getBoundingClientRect(),menu=h.querySelector('button[class~="lg:hidden"]')?.getBoundingClientRect();return {doc:document.documentElement.scrollWidth,navVisible:getComputedStyle(n).display!=='none',nav:{left:nr.left,right:nr.right,top:nr.top,bottom:nr.bottom},logo:logo?{left:logo.left,right:logo.right}:null,menu:menu?{left:menu.left,right:menu.right,width:menu.width,height:menu.height}:null,links,controls}})()`)
    const overlap=m.controls.filter(c=>c.right>m.nav.left+1&&c.left<m.nav.right-1&&c.top<m.nav.bottom&&c.bottom>m.nav.top)
    assert.ok(m.doc<=width+1,`document overflow at ${width}`)
    if(!m.navVisible){assert.ok(m.menu&&m.menu.width>=44&&m.menu.height>=44&&m.menu.right<=width,`usable drawer menu at ${width}`);console.log(`PASS complete navigation ${width}px (drawer)`);passed++;continue}
    assert.ok(m.nav.left>=0&&m.nav.right<=width+1,`navigation outside viewport at ${width}`)
    assert.equal(overlap.length,0,`navigation overlaps account or selector at ${width}`)
    assert.ok(!m.logo||m.nav.left>=m.logo.right-1,`navigation overlaps brand at ${width}`)
    assert.ok(m.links.every(l=>l.left>=m.nav.left-1&&l.right<=m.nav.right+1&&l.bottom-l.top<=44),`link clipping or wrapping at ${width}`)
    console.log(`PASS complete navigation ${width}px`);passed++
  }
  await browser.goto(base+'/#/prep',`!!document.querySelector('[data-prep-root]') && !document.querySelector('[data-prep-action=new]').disabled`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('header.aiq-navbar nav [data-prep-nav]').length`),1)
  assert.equal(await browser.evaluate(`document.querySelector('[data-prep-nav]').getAttribute('aria-current')`),'page')
  console.log('PASS standalone prep route and active navigation');passed++
  await browser.setViewport(1280,900,{mobile:false})
  assert.equal(await browser.evaluate(`(()=>{const h=document.querySelector('header.aiq-navbar'),n=h.querySelector('nav').getBoundingClientRect();return document.documentElement.scrollWidth<=1281&&[...h.querySelectorAll('button,.el-select')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.right<=n.left+1||r.left>=n.right-1||!r.width})})()`),true)
  console.log('PASS active prep navigation fits 1280px with logged-in controls');passed++
  await browser.evaluate(`document.querySelector('#prep-message').value='首节课的备课材料';document.querySelector('#prep-message').dispatchEvent(new Event('input',{bubbles:true}));const files=new DataTransfer();files.items.add(new File(['lesson material'],'课堂材料.txt',{type:'text/plain'}));document.querySelector('#prep-message').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:files}))`)
  await browser.waitFor(`location.hash.includes('/prep/nav1') && document.querySelector('.prep-upload')?.textContent.includes('KB') && !document.querySelector('[data-prep-send]').disabled`)
  assert.equal(await browser.evaluate(`document.querySelector('#prep-message').value`),'首节课的备课材料')
  assert.equal(created,1)
  console.log('PASS first pasted file preserves the draft through real Vue route creation');passed++
  await browser.evaluate(`document.querySelector('[data-prep-send]').click()`)
  await browser.waitFor(`document.querySelector('[data-prep-run-status]')?.textContent==='排队中'`)
  assert.equal(details.get('nav1').messages[0].attachmentIds.length,1)
  assert.equal(details.get('nav1').messages[0].content,'首节课的备课材料')
  assert.equal(await browser.evaluate(`document.querySelector('#prep-message').value`),'')
  console.log('PASS complete-site send carries the selected file and text');passed++
  await browser.evaluate(`document.querySelector('[data-prep-action=new]').click()`)
  await browser.waitFor(`location.hash.includes('/prep/nav2') && !!document.querySelector('.prep-welcome')`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-prep-message]').length+document.querySelectorAll('.prep-upload').length`),0)
  console.log('PASS real new-conversation navigation starts with isolated context');passed++
  if(process.env.E2E_OUTPUT){
    mkdirSync(process.env.E2E_OUTPUT,{recursive:true})
    await browser.screenshot(process.env.E2E_OUTPUT+'/prep-navigation-desktop.png')
    for(const [width,height]of [[320,740],[390,844]]){
      await browser.setViewport(width,height,{mobile:true})
      await browser.evaluate('window.scrollTo(0,0)')
      await browser.screenshot(`${process.env.E2E_OUTPUT}/prep-fullsite-welcome-${width}.png`)
    }
  }
  await browser.setViewport(1366,900,{mobile:false})
  await browser.evaluate(`document.querySelector('[data-prep-action=fullscreen]').click()`)
  assert.ok(await browser.evaluate(`document.querySelector('[data-prep-root]').parentElement===document.body && document.querySelector('#app').inert`))
  console.log('PASS fullscreen escapes compiled route containers and disables background controls');passed++
  await browser.evaluate(`document.querySelector('.prep-heading-actions a[href="#/me/classes"]').click()`)
  await browser.waitFor(`location.hash==='#/me/classes' && !document.querySelector('[data-prep-root]')`)
  assert.ok(await browser.evaluate(`!document.querySelector('#app').inert && document.documentElement.style.overflow!== 'hidden'`))
  console.log('PASS real Vue navigation exits fullscreen and restores the site');passed++
  console.log(`备课全站导航验收 ${passed}/${passed} 通过`)
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
