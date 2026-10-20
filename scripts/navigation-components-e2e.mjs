/** Render actual navigation styles without Vue scope attributes or backend data. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const css = readFileSync(new URL('../site/assets/index-D-SlqVZT.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('./responsive-shell.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('./class-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((err) => {', '  Promise.resolve().catch((err) => {')
  .replace(/\}\)\(\);?\s*$/, `
    globalThis.__classNavTest = { ensureStyle, injectDesktopNav, injectDrawerNav, syncNavActive };
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
    document.body.innerHTML = '<div id="app"><header class="aiq-navbar"><nav><a data-v-af9a52d2 href="#/" class="nav-item rounded-xl px-3.5 py-2 text-[14px] font-medium">首页</a><a data-v-af9a52d2 href="#/teach" class="nav-item rounded-xl px-3.5 py-2 text-[14px] font-medium">课堂教学</a></nav><div class="el-drawer__body"><a href="#/teach">课堂教学</a></div></header><main></main></div>';
    const baseStyle = document.createElement('style');baseStyle.textContent = ${JSON.stringify(css)};document.head.appendChild(baseStyle);
    ${source}
    __classNavTest.ensureStyle();__classNavTest.injectDesktopNav();__classNavTest.injectDrawerNav();
    ${responsive}
  `)
  await check('page canvas removes the browser default margin', `getComputedStyle(document.body).margin === '0px' && document.querySelector('#app').getBoundingClientRect().left === 0`)
  await check('injected desktop link matches the existing navigation text', `getComputedStyle(document.querySelector('nav [data-cls-nav-tab]')).color === getComputedStyle(document.querySelector('nav a[href="#/teach"]')).color && getComputedStyle(document.querySelector('nav [data-cls-nav-tab]')).textDecorationLine === 'none'`)
  await check('injected drawer link has no browser underline', `getComputedStyle(document.querySelector('.el-drawer__body [data-cls-nav-tab]')).textDecorationLine === 'none' && document.querySelector('.el-drawer__body [data-cls-nav-tab]').getBoundingClientRect().height >= 44`)
  await browser.evaluate(`location.hash='#/me/classes/example';__classNavTest.syncNavActive()`)
  await browser.waitFor(`[...document.querySelectorAll('[data-cls-nav-tab]')].every(a=>getComputedStyle(a).color==='rgb(255, 255, 255)')`)
  await check('class routes mark both links current and show the active surface', `[...document.querySelectorAll('[data-cls-nav-tab]')].every(a=>a.getAttribute('aria-current')==='page' && getComputedStyle(a).color==='rgb(255, 255, 255)' && getComputedStyle(a).backgroundImage.includes('linear-gradient'))`)
  await browser.evaluate(`document.documentElement.classList.add('dark')`)
  await check('dark active navigation retains readable text', `getComputedStyle(document.querySelector('nav [data-cls-nav-tab]')).color==='rgb(255, 255, 255)'`)
  await browser.evaluate(`location.hash='#/resources';__classNavTest.syncNavActive()`)
  await check('leaving class routes clears both active states', `[...document.querySelectorAll('[data-cls-nav-tab]')].every(a=>!a.hasAttribute('aria-current') && !a.classList.contains('is-active'))`)
  await browser.setViewport(768, 1024, { mobile: true })
  await browser.evaluate(`const avatarButton=document.createElement('button');avatarButton.id='fixture-user';avatarButton.style.height='40px';avatarButton.textContent='我的';document.querySelector('header').appendChild(avatarButton)`)
  await check('tablet account menu has a 44px touch target', `document.querySelector('#fixture-user').getBoundingClientRect().height >= 44`)
  console.log(`导航组件验收 ${passed}/${passed} 通过`)
} finally {
  await browser.close()
}
