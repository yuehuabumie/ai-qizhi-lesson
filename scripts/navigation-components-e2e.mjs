/** Render the shared teaching hub without Vue scope attributes or backend data. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const css = readFileSync(new URL('../site/assets/index-D-SlqVZT.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('./responsive-shell.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('./prep-studio.js', import.meta.url), 'utf8')
  .replace(/\n\s*boot\(\)\.catch\(/, '\n  Promise.resolve().catch(')
  .replace(/\}\)\(\);?\s*$/, `
    globalThis.__teachHubTest = { ensureStyle, syncTeachingHub };
  })()`)
const browser = await launch()
let passed = 0
async function check(name, expression) {
  assert.equal(await browser.evaluate(expression), true, name)
  console.log(`PASS ${name}`)
  passed++
}
try {
  await browser.evaluate(`
    location.hash = '#/teach';
    document.body.innerHTML = '<header class="aiq-navbar"><nav><a data-v-af9a52d2 href="#/" class="nav-item rounded-xl px-3.5 py-2 text-[14px] font-medium">首页</a><a data-v-af9a52d2 href="#/teach" class="nav-item rounded-xl px-3.5 py-2 text-[14px] font-medium">课堂教学</a></nav></header><main id="app"><section id="fixture-teach"><div class="teach-body"><div class="teach-tabs" role="tablist"><button type="button">工具</button></div><p>教师工具内容</p></div></section><section id="fixture-prep"><div class="prep-page"><div class="prep-wrap"><header class="prep-heading"><h1>智能备课</h1></header><p>备课内容</p></div></div></section><section id="fixture-classes"><div class="cls-studio-root"><div class="cls-container"><h1>班级管理</h1><p>班级内容</p></div></div></section></main>';
    const baseStyle = document.createElement('style');baseStyle.textContent = ${JSON.stringify(css)};document.head.appendChild(baseStyle);
    ${source}
    __teachHubTest.ensureStyle();__teachHubTest.syncTeachingHub();
    ${responsive}
  `)
  await check('page canvas removes the browser default margin', `getComputedStyle(document.body).margin === '0px' && document.querySelector('#app').getBoundingClientRect().left === 0`)
  await check('one in-page hub exposes the three teaching entries', `(()=>{const h=document.querySelector('[data-teach-hub]'),links=[...h.querySelectorAll('[data-teach-entry]')],navHrefs=[...document.querySelectorAll('header.aiq-navbar nav a')].map(a=>a.getAttribute('href'));return document.querySelectorAll('[data-teach-hub]').length===1 && h.getAttribute('aria-label')==='课堂教学入口' && links.length===3 && JSON.stringify(links.map(a=>a.textContent.trim()))==='["教师工具箱","智能备课","班级管理"]' && JSON.stringify(links.map(a=>a.getAttribute('href')))==='["#/teach","#/prep","#/me/classes"]' && links.every(a=>a.querySelector('svg.prep-icon')) && !navHrefs.includes('#/prep') && !navHrefs.includes('#/me/classes')})()`)
  await check('教师工具箱 hub sits beside the tool tabs and highlights the section', `(()=>{const h=document.querySelector('[data-teach-hub]'),t=document.querySelector('header.aiq-navbar a[href="#/teach"]');return h.parentElement.matches('.teach-body') && h.nextElementSibling?.classList.contains('teach-tabs') && h.querySelector('[aria-current="page"]')?.dataset.teachEntry==='teach' && t.classList.contains('is-active') && t.getAttribute('aria-current')==='page'})()`)
  await browser.evaluate(`location.hash='#/prep';__teachHubTest.syncTeachingHub()`)
  await check('智能备课 receives the same hub at the top of its workspace', `(()=>{const h=document.querySelector('[data-teach-hub]'),t=document.querySelector('header.aiq-navbar a[href="#/teach"]');return document.querySelectorAll('[data-teach-hub]').length===1 && h.parentElement.matches('.prep-wrap') && h.parentElement.firstElementChild===h && h.querySelector('[aria-current="page"]')?.dataset.teachEntry==='prep' && t.classList.contains('is-active') && t.getAttribute('aria-current')==='page'})()`)
  await browser.evaluate(`location.hash='#/me/classes/example';__teachHubTest.syncTeachingHub()`)
  await check('班级管理 detail routes keep the hub and highlight the section', `(()=>{const h=document.querySelector('[data-teach-hub]'),t=document.querySelector('header.aiq-navbar a[href="#/teach"]');return document.querySelectorAll('[data-teach-hub]').length===1 && h.parentElement.matches('.cls-container') && h.parentElement.firstElementChild===h && h.querySelector('[aria-current="page"]')?.dataset.teachEntry==='classes' && t.classList.contains('is-active') && t.getAttribute('aria-current')==='page'})()`)
  await browser.evaluate(`location.hash='#/resources';__teachHubTest.syncTeachingHub()`)
  await check('leaving teaching routes removes the hub and clears the top-nav state', `(()=>{const t=document.querySelector('header.aiq-navbar a[href="#/teach"]');return !document.querySelector('[data-teach-hub]') && !t.classList.contains('is-active') && !t.hasAttribute('aria-current') && t.dataset.teachSectionActive===undefined})()`)
  await browser.evaluate(`location.hash='#/teach';__teachHubTest.syncTeachingHub()`)
  await check('hub links render without browser underlines and with readable pills', `(()=>{const h=document.querySelector('[data-teach-hub]'),on=h.querySelector('[aria-current="page"]'),off=h.querySelector('[data-teach-entry="prep"]'),s=getComputedStyle(on);return s.textDecorationLine==='none' && s.color==='rgb(53, 89, 246)' && s.backgroundColor==='rgb(255, 255, 255)' && on.getBoundingClientRect().height>=40 && getComputedStyle(off).textDecorationLine==='none'})()`)
  await browser.evaluate(`document.documentElement.classList.add('dark')`)
  await check('dark active hub text keeps 4.5:1 contrast', `(()=>{const on=document.querySelector('[data-teach-hub] [aria-current="page"]'),parse=v=>v.match(/\\d+(?:\\.\\d+)?/g).slice(0,3).map(Number),lum=c=>{const v=c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]},l1=lum(parse(getComputedStyle(on).color)),l2=lum(parse(getComputedStyle(on).backgroundColor));return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)>=4.5})()`)
  await browser.evaluate(`document.documentElement.classList.remove('dark')`)
  await browser.setViewport(390, 844, { mobile: false })
  const mobile = await browser.evaluate(`(()=>{const h=document.querySelector('[data-teach-hub]'),r=h.getBoundingClientRect(),links=[...h.querySelectorAll('a')];return {display:getComputedStyle(h).display,cols:getComputedStyle(h).gridTemplateColumns.split(' ').filter(Boolean),hub:{left:r.left,right:r.right},innerWidth,doc:document.documentElement.scrollWidth,links:links.map(a=>{const b=a.getBoundingClientRect();return {w:b.width,h:b.height,right:b.right}})}})()`)
  const mobileOK = mobile.display === 'grid' && mobile.cols.length === 3 && mobile.hub.left >= 0 && mobile.hub.right <= mobile.innerWidth + 1 && mobile.doc <= mobile.innerWidth + 1 && mobile.links.length === 3 && mobile.links.every((l) => l.w > 0 && l.h >= 44 && l.right <= mobile.innerWidth + 1)
  assert.ok(mobileOK, `mobile hub layout: ${JSON.stringify(mobile)}`)
  console.log('PASS 390px hub keeps three 44px touch targets without overflow')
  passed++
  console.log(`导航组件验收 ${passed}/${passed} 通过`)
} finally {
  await browser.close()
}
