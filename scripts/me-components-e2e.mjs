/** Browser-only component regressions with mocked API responses; no account or server writes. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const source = readFileSync(new URL('./me-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((err) => {', '  Promise.resolve().catch((err) => {')
  .replace(/\}\)\(\)\s*$/, `
    globalThis.__meTest = {
      mount(mode) { unmountPage(); mountPage({ $el: null }, mode) },
      openCreateModal, openConfirm,
      isCreating: () => S.busy.has('create'),
    }
  })()`)

const browser = await launch()
let passed = 0
async function check(name, expression) {
  assert.equal(await browser.evaluate(expression), true, name)
  console.log(`PASS ${name}`)
  passed++
}
async function key(name, shift = false) {
  await browser.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: name === 'Tab' ? 9 : name === 'Escape' ? 27 : undefined })
  await browser.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name })
}

try {
  await browser.evaluate(`
    document.body.innerHTML = '<main></main><aside id="already-inert" inert>Hidden background</aside>';
    document.body.style.overflow = 'clip';
    window.__user = {id:'test',nickname:'组件验收',email:'test@example.test',avatarHue:210,createdAt:'2026-10-20T00:00:00Z'};
    window.__published = false;
    window.__reply = body => new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
    window.__fetchMock = async (path, options = {}) => {
      if (path === '/api/auth/me' || path === '/api/auth/profile') return __reply({user:__user});
      if (path === '/api/works' && options.method === 'POST') return new Promise(resolve => { window.__finishCreate = () => resolve(__reply({work:{id:'new'}})) });
      if (path.endsWith('/publish')) return new Promise(resolve => { window.__finishPublish = () => {__published=true;resolve(__reply({ok:true}))} });
      return __reply({works:[{id:'work1',title:'测试作品',author:'组件验收',type:'观察记录',module:'m1',grade:'low',desc:'测试说明',published:__published,createdAt:'2026-10-20T00:00:00Z',likes:0}],page:1,total:1,published:__published?1:0,drafts:__published?0:1,filtered:1,hasMore:false});
    };
    window.fetch = window.__fetchMock;
    ${source}
    window.__meTest.mount('works');
  `)
  await browser.waitFor('!!document.querySelector("[data-act=publish]")')
  await check('tabs identify and label their results panel', `[...document.querySelectorAll('[role=tab]')].every(t=>t.getAttribute('aria-controls')==='me-works-grid') && document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby') === 'me-works-tab-all'`)
  await browser.evaluate(`document.querySelector('#me-works-tab-all').focus()`)
  for (const [pressed, expected] of [['ArrowRight','published'],['ArrowRight','draft'],['ArrowRight','all'],['ArrowLeft','draft'],['Home','all'],['End','draft']]) {
    await key(pressed)
    await check(`${pressed} selects and focuses ${expected}`, `document.activeElement.id === 'me-works-tab-${expected}' && document.querySelector('[role=tab][aria-selected=true]').id === 'me-works-tab-${expected}' && document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby') === 'me-works-tab-${expected}' && document.querySelectorAll('[role=tab][tabindex="0"]').length === 1`)
  }

  await browser.evaluate(`document.querySelector('[data-act=new-work]').focus();document.querySelector('[data-act=new-work]').click()`)
  await check('personal modal isolates background and focuses title', `document.querySelector('main').inert && document.body.style.overflow === 'hidden' && document.activeElement.id === 'me-new-title'`)
  await check('form controls align within the field without padding overflow', `[...document.querySelectorAll('.me-modal .me-input')].every(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-1 && r.right<=p.right+1})`)
  await browser.evaluate(`document.querySelector('.me-modal [data-modal-cancel]').focus()`)
  await key('Tab', true)
  await check('reverse Tab wraps to final enabled action', `document.activeElement.matches('[data-me-create-submit]')`)
  await key('Escape')
  await check('Escape restores original inert state, scrolling and trigger', `!document.querySelector('.me-modal') && !document.querySelector('main').inert && document.querySelector('#already-inert').inert && document.body.style.overflow === 'clip' && document.activeElement.matches('[data-act=new-work]')`)

  await browser.evaluate(`__meTest.openConfirm({title:'旧操作',onConfirm:()=>new Promise(resolve=>{window.__finishConfirm=resolve})});document.querySelector('[data-me-confirm]').click()`)
  await key('Escape')
  await browser.evaluate(`__meTest.openCreateModal();window.__finishConfirm()`)
  await browser.waitFor('!!document.querySelector("#me-new-title")')
  await check('old confirmation completion cannot close replacement modal', `document.querySelector('#me-modal-title').textContent === '新建作品'`)

  await browser.evaluate(`document.querySelector('#me-new-title').value='异步测试';document.querySelector('[data-me-create-submit]').click()`)
  await browser.waitFor('typeof window.__finishCreate === "function"')
  await key('Escape')
  await browser.evaluate(`__meTest.openConfirm({title:'新的确认',onConfirm:async()=>{}});window.__finishCreate()`)
  await browser.waitFor('!window.__meTest.isCreating()')
  await check('old save cannot close replacement confirmation', `document.querySelector('#me-modal-title').textContent === '新的确认'`)
  await key('Escape')

  await browser.evaluate(`__meTest.mount('profile')`)
  await browser.waitFor('!!document.querySelector("#me-profile-form")')
  await browser.evaluate(`(()=>{const b=document.querySelector('#me-profile-form button[type=submit]');b.focus();b.click()})()`)
  await browser.waitFor(`document.querySelector('.me-toast')?.textContent === '个人资料已保存'`)
  await check('profile replacement restores the save control focus', `document.activeElement.matches('#me-profile-form button[type=submit]')`)

  await browser.evaluate(`__meTest.mount('works')`)
  await browser.waitFor('!!document.querySelector("[data-act=publish]")')
  await browser.evaluate(`(()=>{const b=document.querySelector('[data-act=publish]');b.focus();b.click()})()`)
  await check('publishing exposes a disabled busy control', `document.querySelector('[data-act=publish]').disabled && document.querySelector('[data-act=publish]').getAttribute('aria-busy') === 'true' && document.querySelector('[data-act=publish]').textContent === '发布中…'`)
  await browser.evaluate(`window.__finishPublish()`)
  await browser.waitFor('!!document.querySelector("[data-act=unpublish]")')
  await check('publishing refresh returns focus to the matching work action', `document.activeElement.matches('[data-act=unpublish][data-id=work1]')`)
  console.log(`个人组件验收 ${passed}/${passed} 通过`)
} finally {
  await browser.close()
}
