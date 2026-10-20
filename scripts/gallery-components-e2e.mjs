/** Real gallery DOM and module, mocked API only. No external requests or business accounts.
 * Run with E2E_BROWSER pointing to a local Chromium/Edge executable if needed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launch } from './lib/cdp-kit.mjs'

const source = readFileSync(new URL('./gallery-studio.js', import.meta.url), 'utf8')
  .replace('  boot().catch((err) => {', '  Promise.resolve().catch((err) => {')
  .replace(/\}\)\(\);?\s*$/, `
    globalThis.__galleryTest = {
      mount(mode = 'list', id = '') {
        unmountPage();
        ctx.router = { currentRoute: {value: {params: {id}}} };
        mountPage({$el: null}, mode);
      },
      openPublishPicker, openConfirm,
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
async function openPicker() {
  await browser.evaluate(`(()=>{const b=document.querySelector('[data-act=publish-mine]');b.focus();b.click()})()`)
  await browser.waitFor(`document.querySelector('[data-gal-pick-list]')?.getAttribute('aria-busy') === 'false'`)
}

try {
  await browser.page.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  await browser.evaluate(`
    document.body.innerHTML = '<main></main><aside id="already-inert" inert>Hidden background</aside>';
    document.body.style.overflow = 'clip';
    window.__reply = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    window.__works = ['first','second'].map((id,i)=>({id,title:'作品'+(i+1),author:'组件验收',type:'AI 课文绘本',module:'m2',grade:'low',desc:'第 1 页：第一幅画。第 2 页：第二幅画。',images:['/uploads/works/portrait.png'],published:false,mine:true,createdAt:'2026-10-20T00:00:00Z',likes:0}));
    window.__drafts = [...__works];
    window.__pending = [];
    window.__publishCalls = 0;
    window.__deferDrafts = false;
    window.__fetchMock = async (path,options={}) => {
      if (path === '/api/auth/me') return __reply({user:{id:'test',nickname:'组件验收'}});
      if (path.startsWith('/api/works/mine?')) {
        if (__deferDrafts) return new Promise(resolve=>{window.__finishDrafts=()=>resolve(__reply({works:__drafts,hasMore:false}))});
        return __reply({works:__drafts,hasMore:false});
      }
      if (path.endsWith('/publish') && options.method === 'POST') {
        __publishCalls++;
        return new Promise(resolve=>__pending.push(ok=>resolve(__reply(ok?{ok:true}:{error:'模拟发布失败'},ok?200:503))));
      }
      if (path.startsWith('/api/works?')) return __reply({works:__works,total:__works.length,hasMore:false,page:1});
      if (path === '/api/works/first') return __reply({work:__works[0]});
      throw new Error('Unexpected API: '+path);
    };
    window.fetch = window.__fetchMock;
    ${source}
    __galleryTest.mount();
  `)
  await browser.waitFor(`document.querySelector('#gal-grid')?.getAttribute('aria-busy') === 'false'`)
  await check('gallery introduction explains that drafts require publication', `document.querySelector('.gal-sub').textContent.includes('发布后才在这里展示')`)
  await openPicker()
  await check('picker isolates background and retains the prior inert state', `document.querySelector('main').inert && document.querySelector('#already-inert').inert && document.body.style.overflow === 'hidden' && document.activeElement.matches('[data-modal-close]')`)
  await check('picker lists both drafts with an initially disabled publish control', `document.querySelectorAll('[data-gal-pick]').length === 2 && document.querySelector('[data-gal-publish]').disabled`)
  await browser.evaluate(`document.querySelector('[data-gal-pick-all]').click()`)
  await check('select all updates rows, count and publishing action', `[...document.querySelectorAll('[data-gal-pick]')].every(b=>b.checked) && document.querySelector('[data-gal-pick-count]').textContent === '已选 2 份' && !document.querySelector('[data-gal-publish]').disabled`)
  await browser.evaluate(`document.querySelector('[data-gal-pick]').click()`)
  await check('one deselected row sets the all control to indeterminate', `document.querySelector('[data-gal-pick-all]').indeterminate && !document.querySelector('[data-gal-pick-all]').checked && document.querySelector('[data-gal-pick-count]').textContent === '已选 1 份'`)
  await browser.evaluate(`document.querySelector('[data-gal-pick-all]').click();document.querySelector('[data-gal-publish]').click()`)
  await browser.waitFor(`__pending.length === 1`)
  await check('publishing disables all selectors and exposes a stable busy label', `document.querySelector('[data-gal-publish]').disabled && document.querySelector('[data-gal-publish]').getAttribute('aria-busy') === 'true' && document.querySelector('[data-gal-publish]').textContent === '发布中…' && [...document.querySelectorAll('.gal-picker input')].every(b=>b.disabled)`)
  await browser.evaluate(`document.querySelector('[data-gal-pick-all]').click();document.querySelector('[data-gal-publish]').click()`)
  await check('busy controls cannot start another batch or change selection', `__publishCalls === 1 && document.querySelector('[data-gal-pick-count]').textContent === '已选 2 份' && document.querySelector('[data-gal-publish]').textContent === '发布中…'`)
  await browser.evaluate(`__pending.shift()(false)`)
  await browser.waitFor(`__pending.length === 1 && __publishCalls === 2`)
  await browser.evaluate(`__pending.shift()(false)`)
  await browser.waitFor(`document.querySelector('[data-gal-pick-error]')?.classList.contains('show')`)
  await check('failed batch restores selection controls and reports the error', `document.querySelector('[data-gal-publish]').getAttribute('aria-busy') === 'false' && document.querySelector('[data-gal-publish]').disabled && [...document.querySelectorAll('.gal-picker input')].every(b=>!b.disabled) && document.querySelector('[data-gal-pick-error]').textContent.includes('模拟发布失败')`)

  await browser.evaluate(`document.querySelector('[data-modal-close]').focus()`)
  await key('Tab', true)
  await check('reverse Tab wraps to the last enabled action', `document.activeElement.matches('[data-modal-cancel]')`)
  await key('Tab')
  await check('Tab from the last action wraps to the close button', `document.activeElement.matches('[data-modal-close]')`)
  await key('Escape')
  await check('Escape restores scrolling, original inert values and trigger focus', `!document.querySelector('.gal-modal') && !document.querySelector('main').inert && document.querySelector('#already-inert').inert && document.body.style.overflow === 'clip' && document.activeElement.matches('[data-act=publish-mine]')`)

  await browser.evaluate(`__drafts=[]`)
  await openPicker()
  await check('empty state hides the all-selection header', `document.querySelector('[data-gal-picker-head]').hidden && getComputedStyle(document.querySelector('[data-gal-picker-head]')).display === 'none' && document.querySelector('[data-gal-publish]').disabled`)
  await key('Escape')
  await browser.evaluate(`__drafts=[...__works];__deferDrafts=true`)
  await browser.evaluate(`__galleryTest.openPublishPicker()`)
  await browser.waitFor(`typeof __finishDrafts === 'function'`)
  await key('Escape')
  await browser.evaluate(`__galleryTest.openConfirm({title:'新的确认',onConfirm:async()=>{}});__finishDrafts();__deferDrafts=false`)
  await check('a closed picker loading response cannot replace a newer modal', `document.querySelector('#gal-modal-title').textContent === '新的确认'`)
  await key('Escape')

  await browser.evaluate(`__galleryTest.openConfirm({title:'旧确认',onConfirm:()=>new Promise(resolve=>{window.__finishConfirm=resolve})});document.querySelector('[data-modal-ok]').click()`)
  await key('Escape')
  await browser.evaluate(`__galleryTest.openConfirm({title:'替换后的确认',onConfirm:async()=>{}});__finishConfirm()`)
  await check('a completed old confirmation cannot dismiss its replacement', `document.querySelector('#gal-modal-title').textContent === '替换后的确认'`)
  await key('Escape')

  await openPicker()
  await browser.evaluate(`document.querySelector('[data-gal-pick]').click();document.querySelector('[data-gal-publish]').click()`)
  await browser.waitFor(`__pending.length === 1`)
  await key('Escape')
  await browser.evaluate(`__galleryTest.openConfirm({title:'发布中的新确认',onConfirm:async()=>{}});__pending.shift()(true)`)
  await browser.waitFor(`document.querySelector('.gal-toast')?.textContent === '已发布 1 份作品'`)
  await check('old publication completion cannot close another modal', `document.querySelector('#gal-modal-title').textContent === '发布中的新确认'`)
  await key('Escape')

  await browser.evaluate(`__galleryTest.mount('detail','first')`)
  await browser.waitFor(`!!document.querySelector('.gal-face-media img')`)
  await check('book page images retain their complete content', `getComputedStyle(document.querySelector('.gal-face-media img')).objectFit === 'contain'`)
  await check('draft work metadata describes creation rather than publication', `[...document.querySelectorAll('.gal-info-row dt')].some(t=>t.textContent === '创建时间') && ![...document.querySelectorAll('.gal-info-row dt')].some(t=>t.textContent === '发布时间')`)
  await browser.evaluate(`__works[0].type='观察记录';__galleryTest.mount('detail','first')`)
  await browser.waitFor(`!!document.querySelector('.gal-image-strip img')`)
  await check('detail image strips retain complete content inside the existing frame', `getComputedStyle(document.querySelector('.gal-image-strip img')).objectFit === 'contain' && getComputedStyle(document.querySelector('.gal-image-strip img')).aspectRatio === '4 / 3'`)
  await browser.evaluate(`__galleryTest.mount()`)
  await browser.waitFor(`!!document.querySelector('.gal-cover-img')`)
  await check('list thumbnails keep their cover crop', `getComputedStyle(document.querySelector('.gal-cover-img')).objectFit === 'cover'`)
  console.log(`展厅组件验收 ${passed}/${passed} 通过`)
} finally {
  await browser.close()
}
