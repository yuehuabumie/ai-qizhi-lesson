/** Dynamic pages, long content, dialogs, and recoverable failures on mobile. */
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeClient, registerUser, cleanupUser } from './lib/kit.mjs'
import { launch, sleep } from './lib/cdp-kit.mjs'
import { measureLayout, layoutFailures } from './lib/responsive-metrics.mjs'

const API = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const WEB = process.env.E2E_BASE || 'https://yuehua.online'
const EMAIL = process.env.ASSIGN_E2E_EMAIL || '301@301.group'
const NICK = '移动端细节验收'
const output = process.env.AUDIT_OUTPUT || mkdtempSync(join(tmpdir(), 'aiq-mobile-detail-'))
mkdirSync(output, { recursive: true })
const teacher = makeClient(API)
const reports = []
let browser, classId = '', viewport
const check = (name, pass) => { reports.push({ name, failures: pass ? [] : [name] }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`) }
const value = (selector, text) => `(() => {const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`
const call = async (path, options) => {
  const r = await teacher.call(path, options)
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${path}: ${r.text.slice(0, 180)}`)
  return r.json
}
async function shot(name) {
  for (const theme of ['light', 'dark']) {
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
    await sleep(100)
    const metrics = await browser.evaluate(`(${measureLayout.toString()})(${JSON.stringify(viewport)})`)
    const failures = layoutFailures(metrics)
    reports.push({ name, theme, metrics, failures })
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${name}/${theme} ${failures.join('; ')}`)
    await browser.screenshot(`${output}/${name}-${theme}.png`)
  }
  await browser.evaluate(`document.documentElement.classList.remove('dark')`)
}
async function key(key, shift = false) {
  await browser.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: key === 'Tab' ? 9 : 27 })
  await browser.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key })
}

cleanupUser(API, EMAIL, NICK)
try {
  await registerUser(teacher, { email: EMAIL, password: 'Mobile-' + randomBytes(8).toString('hex'), nickname: NICK })
  classId = (await call('/api/classes', { method: 'POST', body: { name: '移动端验收班级' + '长标题'.repeat(16) } })).class.id
  const names = ['长姓名' + '欧阳'.repeat(13), ...Array.from({ length: 99 }, (_, i) => `同学${i + 1}`)]
  await call(`/api/classes/${classId}/members`, { method: 'POST', body: { names } })
  const taskId = (await call(`/api/classes/${classId}/assignments`, { method: 'POST', body: { type: 'task', moduleId: 'm2', stage: 'mid', activity: '提示词拆解', title: '长作业标题' + 'ABCDEFGHIJKLMNOPQRST'.repeat(5), instructions: 'LongInstructions'.repeat(60) } })).assignment.id
  const task = (await call(`/api/classes/${classId}/assignments/${taskId}`)).assignment
  const work = (await call('/api/works', { method: 'POST', body: { title: '移动端长作品' + 'UnbrokenTitle'.repeat(8), type: '观察记录', module: 'm1', grade: 'low', desc: '长作品说明'.repeat(150), hue: 200 } })).work
  if (!work?.id) throw new Error('未取得测试作品 ID')
  browser = await launch()
  await browser.setCookie('aiq_session', teacher.jar.replace(/^aiq_session=/, ''), WEB)
  for (const [width, height, mobile] of [[1366, 768, false], [1024, 768, false], [844, 390, true], [768, 1024, true], [390, 844, true], [320, 740, true]]) {
    viewport = { width, height }
    await browser.setViewport(width, height, { mobile })
    await browser.goto(`${WEB}/#/me/classes/${classId}`, `document.querySelectorAll('.cls-member').length === 100`)
    await shot(`long-class-${width}`)
    await browser.evaluate(`document.querySelector('.cls-roster').scrollIntoView()`)
    await shot(`roster100-${width}`)
    await browser.goto(`${WEB}/#/me/classes/${classId}/assignments/${taskId}`, `!!document.querySelector('.cls-table-card')`)
    await shot(`long-assignment-${width}`)
    await browser.evaluate(`document.querySelector('.cls-table-card').scrollIntoView()`)
    await shot(`long-assignment-table-${width}`)
    await browser.goto(`${WEB}/#/gallery/${work.id}`, `!!document.querySelector('.gal-detail')`)
    await shot(`gallery-detail-${width}`)
    await browser.goto(`${WEB}/#/gallery`, `!!document.querySelector('[data-act="publish-mine"]')`)
    await browser.evaluate(`document.querySelector('[data-act="publish-mine"]').click()`)
    await browser.waitFor(`!!document.querySelector('.gal-pick-row') || !!document.querySelector('.gal-pick-title')`)
    await shot(`gallery-picker-${width}`)
    await browser.evaluate(`document.querySelector('.gal-modal [data-modal-cancel]').click()`)
    await browser.goto(`${WEB}/#/me/works`, `!!document.querySelector('[data-act="new-work"]')`)
    await browser.evaluate(`document.querySelector('[data-act="new-work"]').click()`)
    await browser.waitFor(`!!document.querySelector('#me-create-form')`)
    await shot(`new-work-modal-${width}`)
    await key('Escape')
  }

  viewport = { width: 390, height: 844 }
  await browser.setViewport(390, 844, { mobile: true })
  await browser.page.send('Network.setBlockedURLs', { urls: [`*/api/classes/${classId}`] })
  await browser.goto(`${WEB}/#/me/classes/${classId}`, `!!document.querySelector('[data-act="retry-class"]')`)
  check('断网时班级显示重试入口', true)
  await browser.page.send('Network.setBlockedURLs', { urls: [] })
  await browser.evaluate(`document.querySelector('[data-act="retry-class"]').click()`)
  await browser.waitFor(`document.querySelectorAll('.cls-member').length === 100`)
  check('恢复网络后重试加载完整名单', true)

  await browser.clearCookies()
  await browser.goto(`${WEB}/#/assign/${task.token}`, `!!document.querySelector('#sbk-assign-name')`)
  await browser.evaluate(value('#sbk-assign-name', names[0]))
  await browser.evaluate(`document.querySelector('form[data-assign-form] button[type="submit"]').click()`)
  await browser.waitFor(`!!document.querySelector('[data-assign-task-text]')`)
  await shot('long-student-task-390')
  await browser.evaluate(value('[data-assign-task-text]', '照片提交失败后保留这段文字，恢复后可以重新提交。'))
  const photo = `${output}/photo.png`
  writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  await browser.page.send('DOM.enable')
  const doc = await browser.page.send('DOM.getDocument')
  const input = await browser.page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-assign-task-file]' })
  await browser.page.send('DOM.setFileInputFiles', { files: [photo], nodeId: input.nodeId })
  await browser.waitFor(`!!document.querySelector('.sbk-task-thumb img')`)
  await browser.evaluate(`document.querySelector('[data-act="assign-leave"]').focus();document.querySelector('[data-act="assign-leave"]').click()`)
  await browser.waitFor(`!!document.querySelector('.sbk-modal')`)
  check('绘本通用确认弹窗锁定背景', await browser.evaluate(`document.querySelector('#app').inert && document.body.style.overflow === 'hidden'`))
  await key('Tab', true)
  check('确认弹窗反向Tab循环', await browser.evaluate(`document.activeElement.matches('[data-modal-ok]')`))
  await shot('student-confirm-390')
  await key('Escape')
  check('确认弹窗关闭恢复背景与焦点', await browser.evaluate(`!document.querySelector('.sbk-modal') && !document.querySelector('#app').inert && document.body.style.overflow !== 'hidden' && document.activeElement.matches('[data-act="assign-leave"]')`))
  await browser.evaluate(`(() => {const original=window.fetch;let fail=true;window.fetch=async(...args)=>{if(fail && String(args[0]).endsWith('/submit')){fail=false;return new Response(JSON.stringify({error:{message:'验收模拟：照片提交暂时失败'}}),{status:503,headers:{'content-type':'application/json'}})}return original(...args)}})()`)
  await browser.evaluate(`document.querySelector('[data-act="assign-task-submit"]').click()`)
  await browser.waitFor(`document.querySelector('.sbk-assign-error')?.textContent.includes('暂时失败')`)
  check('提交失败保留文字照片并允许重试', await browser.evaluate(`document.querySelector('[data-assign-task-text]').value.includes('保留这段文字') && !!document.querySelector('.sbk-task-thumb img') && !document.querySelector('[data-act="assign-task-submit"]').disabled`))
  await shot('task-submit-failure-390')
  await browser.evaluate(`document.querySelector('[data-act="assign-task-submit"]').click()`)
  await browser.waitFor(`!!document.querySelector('.sbk-submitted')`)
  check('恢复后真实提交文字照片', await browser.evaluate(`!!document.querySelector('.sbk-task-photos.is-readonly img')`))

  await browser.clearCookies()
  await browser.setCookie('aiq_session', teacher.jar.replace(/^aiq_session=/, ''), WEB)
  await browser.goto(`${WEB}/#/me/classes/${classId}/assignments/${taskId}`, `!!document.querySelector('[data-act="open-submission"]:not([disabled])')`)
  await browser.evaluate(`(() => {const original=window.fetch;let n=0;window.fetch=async(...args)=>{if(String(args[0]).includes('/submissions/')){n++;if(n===1){await new Promise(r=>setTimeout(r,400));return new Response(JSON.stringify({error:{message:'验收模拟：旧请求失败'}}),{status:503})}if(n===2) await new Promise(r=>setTimeout(r,1200))}return original(...args)}})()`)
  await browser.evaluate(`document.querySelector('[data-act="open-submission"]:not([disabled])').click()`)
  await key('Escape')
  await browser.evaluate(`document.querySelector('[data-act="open-submission"]:not([disabled])').click()`)
  await sleep(700)
  check('旧预览请求失败不关闭新弹窗', await browser.evaluate(`!!document.querySelector('.cls-modal-loading')`))
  await browser.waitFor(`!!document.querySelector('.cls-modal-body')`)
  check('新预览正常显示学生文字照片', await browser.evaluate(`!!document.querySelector('.cls-modal-body img')`))
  await key('Escape')
} catch (err) {
  reports.push({ name: 'runtime', failures: [err.message] })
  console.error(err)
} finally {
  if (browser) await browser.close()
  try { if (classId) await call(`/api/classes/${classId}`, { method: 'DELETE' }) } catch (err) { reports.push({ failures: ['清理班级失败: ' + err.message] }) }
  cleanupUser(API, EMAIL, NICK)
  writeFileSync(`${output}/report.json`, JSON.stringify({ base: WEB, reports }, null, 2))
  const failed = reports.filter(r => r.failures.length)
  console.log(`细节验收 ${reports.length - failed.length}/${reports.length} 通过`)
  if (failed.length) process.exitCode = 1
}
