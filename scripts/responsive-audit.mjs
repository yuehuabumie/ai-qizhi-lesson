import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeClient, registerUser, cleanupUser } from './lib/kit.mjs'
import { launch } from './lib/cdp-kit.mjs'
import { measureLayout, layoutFailures } from './lib/responsive-metrics.mjs'

const API = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const WEB = process.env.E2E_BASE || 'https://yuehua.online'
const EMAIL = process.env.ASSIGN_E2E_EMAIL || '301@301.group'
const NICK = '响应式验收'
const PASSWORD = 'Resp-' + randomBytes(6).toString('hex')
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const tmp = mkdtempSync(join(tmpdir(), 'resp-audit-'))
const photoPath = join(tmp, 'photo.png')
writeFileSync(photoPath, Buffer.from(TINY_PNG.split(',')[1], 'base64'))

const teacher = makeClient(API)
const tcall = teacher.call
let classId = ''
let teacherBrowser = null
let studentBrowser = null
const output = process.env.AUDIT_OUTPUT || mkdtempSync(join(tmpdir(), 'aiq-responsive-'))
mkdirSync(output, { recursive: true })
const reports = []
function check(name, condition) {
  reports.push({ name, failures: condition ? [] : [name] })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
}
let requestedViewport = { width: 1366, height: 768 }
const viewports = [
  [1366, 768, '1366x768', false],
  [1024, 768, '1024x768', false],
  [844, 390, '844x390', true],
  [768, 1024, '768x1024', true],
  [390, 844, '390x844', true],
]

function requireOK(response, label) {
  if (response.status !== 200) throw new Error(`${label}: HTTP ${response.status} ${response.text.slice(0, 180)}${response.status === 429 ? '；限流仍在生效，请等待冷却后重跑' : ''}`)
}

function makeStudent() {
  const jar = new Map()
  async function call(path, { method = 'GET', body } = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(API + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (!value || /expires=thu, 01 jan 1970/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  }
  return { call }
}

cleanupUser(API, EMAIL, NICK)

async function setup() {
  await registerUser(teacher, { email: EMAIL, password: PASSWORD, nickname: NICK })
  const cls = await tcall('/api/classes', { method: 'POST', body: { name: '横屏与响应式验收班' } })
  classId = cls.json?.class?.id
  if (!classId) throw new Error('创建班级失败: ' + cls.text)
  const names = ['小明', '小红', '小刚', '欧阳娜娜', ...viewports.flatMap(([, , vp]) => ['小美', '小丽', '小强'].map((name) => `${name}-${vp}`))]
  const mem = await tcall(`/api/classes/${classId}/members`, { method: 'POST', body: { names } })
  if (mem.status !== 200) throw new Error('导入名单失败: ' + mem.text)
  const mk = async (body) => {
    const r = await tcall(`/api/classes/${classId}/assignments`, { method: 'POST', body })
    if (r.status !== 200) throw new Error('创建作业失败: ' + r.text)
    return r.json.assignment.id
  }
  const labId = await mk({ title: 'AI 的五官配对', type: 'lab', labId: 'ai-senses', instructions: '完成五官配对练习，尽量拿满分。' })
  const taskId = await mk({ title: '提示词拆解', type: 'task', moduleId: 'm2', stage: 'mid', activity: '提示词拆解', toolLabId: 'prompt-builder', instructions: '观察家里的智能设备，写下发现并拍照。' })
  const storyId = await mk({ title: '横屏验收绘本', type: 'storybook', instructions: '完成一页绘本并提交。' })
  const lab = (await tcall(`/api/classes/${classId}/assignments/${labId}`)).json.assignment
  const task = (await tcall(`/api/classes/${classId}/assignments/${taskId}`)).json.assignment
  const story = (await tcall(`/api/classes/${classId}/assignments/${storyId}`)).json.assignment

  const sLab = makeStudent()
  requireOK(await sLab.call(`/api/assign/${lab.token}/verify`, { method: 'POST', body: { name: '小红' } }), '准备练习学生')
  const labSub = await sLab.call(`/api/assign/${lab.token}/submit`, {
    method: 'POST',
    body: {
      kind: 'lab', labId: 'ai-senses', score: 88, note: '横屏验收：我学会了观察五官的位置。',
      work: { title: '五官配对记录', type: '互动练习', module: 'm1', grade: 'low', desc: '完成五官配对，得分 88。', hue: 200 },
    },
  })
  const sTask = makeStudent()
  requireOK(await sTask.call(`/api/assign/${task.token}/verify`, { method: 'POST', body: { name: '小刚' } }), '准备任务学生')
  const taskSub = await sTask.call(`/api/assign/${task.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '我找到了智能音箱、扫地机器人和智能台灯，并按位置画了下来。', images: [TINY_PNG] },
  })
  const sStory = makeStudent()
  requireOK(await sStory.call(`/api/assign/${story.token}/verify`, { method: 'POST', body: { name: '小明' } }), '准备绘本学生')
  const storySub = await sStory.call(`/api/assign/${story.token}/submit`, {
    method: 'POST',
    body: {
      kind: 'storybook', poemName: '静夜思',
      pages: [{ who: '李白', where: '窗前', doing: '望月', color: '冷蓝', mood: '思念', image: TINY_PNG }],
    },
  })
  for (const [name, r] of [['lab', labSub], ['task', taskSub], ['story', storySub]]) {
    if (r.status !== 200) throw new Error(`${name} 提交失败: ${r.text}`)
  }
  return { lab, task, story }
}

async function pageMetrics(p) {
  return p.evaluate(`(${measureLayout.toString()})(${JSON.stringify(requestedViewport)})`)
}

function summarize(label, m) {
  console.log(`[${label}] ${m.width}x${m.height} docW=${m.docWidth} scale=${m.scale} <24=${m.small24.length} <44=${m.small44.length}`)
}

async function shot(p, name) {
  for (const theme of ['light', 'dark']) {
    await p.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); true`)
    await new Promise((r) => setTimeout(r, 180))
    const metrics = await pageMetrics(p)
    const failures = layoutFailures(metrics)
    reports.push({ name, theme, metrics, failures })
    if (failures.length) console.error(`  FAIL ${name}/${theme}: ${failures.join(' | ')}`)
    await p.screenshot(join(output, `${name}-${theme}.png`))
  }
  await p.evaluate(`document.documentElement.classList.remove('dark'); true`)
}

async function auditPage(p, label, path, ready, name) {
  await p.goto(WEB + path, ready)
  await new Promise((r) => setTimeout(r, 500))
  const m = await pageMetrics(p)
  summarize(label, m)
  await shot(p, name)
  return m
}

try {
  const { lab, task, story } = await setup()
  console.log(`数据准备完成：班级=${classId}\n  lab=${lab.title}  task=${task.title}  story=${story.title}`)

  teacherBrowser = await launch({ width: 1366, height: 768 })
  const p = teacherBrowser
  await p.setCookie('aiq_session', teacher.jar.replace(/^aiq_session=/, ''), WEB)
  const browser = teacherBrowser

  for (const [w, h, vp, mobile] of viewports) {
    requestedViewport = { width: w, height: h }
    await p.setViewport(w, h, { mobile })
    console.log(`\n========== 教师端 ${vp} ==========`)
    await auditPage(p, 'class-list', `/#/me/classes`, '!!document.querySelector(".cls-grid")', `teacher-list-${vp}`)

    await auditPage(p, 'class-detail-top', `/#/me/classes/${classId}`, '!!document.querySelector("[data-cls-root] form[data-form=\\"create-assignment\\"]")', `teacher-class-${vp}`)
    await p.evaluate(`(() => { const button = document.querySelector('[data-act="rename-class"]'); button.focus(); button.click() })()`)
    await p.waitFor('!!document.querySelector(".cls-modal")', 5000, 'rename modal')
    check(`弹窗名称与背景隔离-${vp}`, await p.evaluate(`!!document.querySelector('.cls-modal[aria-labelledby]') && document.querySelector('#app').inert`))
    await shot(p, `teacher-rename-${vp}`)
    await p.evaluate(`(() => { const buttons = document.querySelectorAll('.cls-modal button'); buttons[buttons.length - 1].focus() })()`)
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    check(`Tab焦点留在弹窗-${vp}`, await p.evaluate(`document.querySelector('.cls-modal').contains(document.activeElement)`))
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    check(`关闭恢复焦点-${vp}`, await p.evaluate(`!document.querySelector('.cls-modal') && document.activeElement.matches('[data-act="rename-class"]') && !document.querySelector('#app').inert`))
    await p.evaluate(`document.querySelector('[data-act="rename-class"]').click(); document.querySelector('.cls-modal button[type="submit"]').click()`)
    await p.waitFor(`!document.querySelector('.cls-modal') && !!document.querySelector('[data-act="rename-class"]')`, 10000, 'save and rerender')
    check(`保存重绘后恢复焦点-${vp}`, await p.evaluate(`document.activeElement.matches('[data-act="rename-class"]')`))
    // 滚到作业区
    await p.evaluate(`document.querySelector('.cls-assignments').scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 350))
    const mAssign = await pageMetrics(p)
    summarize('class-detail-assignments', mAssign)
    await shot(p, `teacher-class-assign-${vp}`)
    // 滚到名单
    await p.evaluate(`document.querySelector('.cls-roster').scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 350))
    await shot(p, `teacher-class-roster-${vp}`)

    // 作业详情（互动练习）
    await auditPage(p, 'assignment-lab', `/#/me/classes/${classId}/assignments/${lab.id}`, '!!document.querySelector(".cls-table-card")', `teacher-lab-${vp}`)
    await p.evaluate(`document.querySelector('.cls-table-card').scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 350))
    const mTable = await pageMetrics(p)
    summarize('assignment-lab-table', mTable)
    await shot(p, `teacher-lab-table-${vp}`)

    // 查看提交弹窗
    const canOpen = await p.evaluate(`!!document.querySelector('.cls-row-actions [data-act="open-submission"]:not([disabled])')`)
    if (canOpen) {
      await p.evaluate(`document.querySelector('.cls-row-actions [data-act="open-submission"]:not([disabled])').click()`)
      await p.waitFor('!!document.querySelector(".cls-modal")', 5000, 'submission modal')
      await new Promise((r) => setTimeout(r, 300))
      const modal = await p.evaluate(`JSON.stringify((() => { const m=document.querySelector('.cls-modal'); const r=m.getBoundingClientRect(); const body=m.querySelector('.cls-modal-body'); return { rect:{x:r.x,y:r.y,w:r.width,h:r.height}, vh:innerHeight, vw:innerWidth, bodyScrollH: body ? body.scrollHeight : null, bodyClientH: body ? body.clientHeight : null, overflowY: body ? getComputedStyle(body).overflowY : null, footer: !!m.querySelector('.cls-modal-foot') } })())`)
      console.log(`  modal: ${modal}`)
      await shot(p, `teacher-modal-lab-${vp}`)
      await p.evaluate(`document.querySelector('.cls-modal [data-act="close-modal"]').click()`)
      await new Promise((r) => setTimeout(r, 250))
    }

    // 课程任务详情
    await auditPage(p, 'assignment-task', `/#/me/classes/${classId}/assignments/${task.id}`, '!!document.querySelector(".cls-table-card")', `teacher-task-${vp}`)
    await p.evaluate(`document.querySelector('.cls-table-card').scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 350))
    await shot(p, `teacher-task-table-${vp}`)

    // 绘本详情
    await auditPage(p, 'assignment-story', `/#/me/classes/${classId}/assignments/${story.id}`, '!!document.querySelector(".cls-table-card")', `teacher-story-${vp}`)

    if (process.env.AUDIT_WHOLE_SITE === '1') {
      const routes = ['/', '/about', '/curriculum', '/curriculum/m1', '/curriculum/m2', '/curriculum/m3', '/curriculum/m4', '/lab', '/teach', '/resources', '/videos', '/gallery', '/me', '/me/works',
        ...['device-detection','ai-senses','input-output','ai-mistakes','fruit-trainer','ethics-court','storybook','prompt-builder','virtual-museum','mr-designer','inventor','plant-butler','quiz-arena'].map((id) => `/lab/${id}`)]
      for (const route of routes) {
        const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-')
        await auditPage(p, name, '/#' + route, '!!document.querySelector("main h1,main h2")', `site-${name}-${vp}`)
        if (route === '/lab/virtual-museum' && mobile) {
          check(`博物馆格子与局部滚动-${vp}`, await p.evaluate(`(() => { const grid=document.querySelector('main .grid:has(>button.aspect-square)'), panel=grid?.parentElement?.parentElement; return !!panel && grid.children.length === 70 && [...grid.children].every(b=>b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44 && !!b.getAttribute('aria-label')) && getComputedStyle(panel).overflowX === 'auto' })()`))
        }
        if (mobile && ['/lab/fruit-trainer', '/lab/prompt-builder', '/lab/virtual-museum'].includes(route)) {
          check(`训练选项触控范围-${name}-${vp}`, await p.evaluate(`(() => { const controls=[...document.querySelectorAll('main .el-select__wrapper,main .el-radio,main .el-radio-button__inner,main .el-checkbox')].filter(e=>e.getClientRects().length); return controls.every(e=>{const r=e.getBoundingClientRect();return r.width>=44 && r.height>=44}) })()`))
        }
      }
      if (w < 1024) {
        await p.evaluate(`document.querySelector('header button[class~="lg:hidden"]').click()`)
        await p.waitFor('!!document.querySelector(".el-drawer__body [data-cls-nav-tab]")', 6000, 'mobile drawer')
        await new Promise((r) => setTimeout(r, 350))
        await shot(p, `site-drawer-${vp}`)
        check(`抽屉高度与触控行-${vp}`, await p.evaluate(`(() => { const d=document.querySelector('.el-drawer'), link=d.querySelector('[data-cls-nav-tab]'); return d.getBoundingClientRect().height > innerHeight - 20 && link.getBoundingClientRect().height >= 44 })()`))
        await p.evaluate(`document.querySelector('.el-drawer__body [data-cls-nav-tab]').click()`)
        await p.waitFor('!document.querySelector(".el-overlay") || getComputedStyle(document.querySelector(".el-overlay")).display === "none"', 6000, 'drawer closed')
        check(`抽屉点击班级后关闭-${vp}`, await p.evaluate(`location.hash === '#/me/classes'`))
      }
    }
  }
  await browser.close()
  teacherBrowser = null
  console.log('\n教师端截图完成')

  // ── 学生端 ───────────────────────────────────────────────
  studentBrowser = await launch({ width: 1366, height: 768 })
  const s = studentBrowser

  if (process.env.AUDIT_WHOLE_SITE === '1') {
    for (const [w, h, vp, mobile] of viewports) {
      requestedViewport = { width: w, height: h }
      await s.setViewport(w, h, { mobile })
      for (const route of ['/login', '/register']) {
        await auditPage(s, route.slice(1), '/#' + route, '!!document.querySelector("main input")', `site-${route.slice(1)}-${vp}`)
      }
    }
  }

  async function studentMetrics(label, name) {
    await new Promise((r) => setTimeout(r, 500))
    const m = await pageMetrics(s)
    summarize(label, m)
    await shot(s, name)
    return m
  }

  async function gate(token, name, label) {
    await s.goto(`${WEB}/#/assign/${token}`, '!!document.querySelector("form[data-assign-form]")')
    await studentMetrics(label + '-gate', label + '-gate')
    await s.evaluate(`(() => {
      window.__auditVerify = null
      const original = window.fetch
      window.fetch = async (...args) => {
        const response = await original(...args)
        if (String(args[0]).endsWith('/verify')) window.__auditVerify = { status: response.status, text: await response.clone().text() }
        return response
      }
    })()`)
    const setVal = (sel, v) => `(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.value=${JSON.stringify(v)}; el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`
    await s.evaluate(setVal('#sbk-assign-name', name))
    await s.evaluate('document.querySelector(\'form[data-assign-form] button[type="submit"]\').click()')
    await s.waitFor('!!window.__auditVerify', 15000, '姓名核对响应')
    requireOK(await s.evaluate('window.__auditVerify'), '浏览器姓名核对')
  }

  for (const [w, h, vp, mobile] of viewports) {
    requestedViewport = { width: w, height: h }
    await s.setViewport(w, h, { mobile })
    await s.clearCookies()
    console.log(`\n========== 学生端 ${vp} ==========`)

    // 互动练习：入口 → 练习 → 监考条 → 回作业
    await gate(lab.token, `小美-${vp}`, `student-lab-${vp}`)
    await s.waitFor('!!document.querySelector(\'[data-act="assign-open-lab"]\')', 15000, 'lab workbench')
    await studentMetrics('lab-workbench-empty', `student-lab-workbench-${vp}`)
    await s.evaluate('document.querySelector(\'[data-act="assign-open-lab"]\').click()')
    await s.waitFor('location.hash.includes("/lab/ai-senses")', 15000, 'lab page')
    await s.waitFor('!!document.querySelector("[data-sbk-supervisor]")', 15000, 'supervisor')
    await new Promise((r) => setTimeout(r, 500))
    await s.evaluate(`(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const app = pinia._s.get('app')
      return app.markLab('ai-senses', 86)
    })()`)
    await s.waitFor('document.querySelector("[data-sbk-supervisor]").textContent.includes("本次成绩 86 分")', 8000, 'score')
    const sup = await s.evaluate(`JSON.stringify((() => {
      const bar=document.querySelector('[data-sbk-supervisor]'); const r=bar.getBoundingClientRect();
      const links=[...bar.querySelectorAll('button')].map(b=>{const x=b.getBoundingClientRect(); return {t:b.textContent.trim(), w:+x.width.toFixed(1), h:+x.height.toFixed(1)}})
      return {rect:{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}, vw:innerWidth, vh:innerHeight,
        bodyPad:getComputedStyle(document.body).paddingBottom, bottom:getComputedStyle(bar).bottom, buttons:links, docW:document.documentElement.scrollWidth}
    })())`)
    console.log(`  supervisor: ${sup}`)
    await shot(s, `student-lab-supervisor-${vp}`)
    await s.evaluate(`document.querySelector('.sbk-supervisor-back').click()`)
    await s.waitFor('location.hash.startsWith("#/assign/")', 15000, 'back to assign')
    await s.waitFor('!!document.querySelector(".sbk-assign-shell")', 15000, 'assign workbench')
    await studentMetrics('lab-workbench-scored', `student-lab-scored-${vp}`)

    // 课程任务
    await s.clearCookies()
    await gate(task.token, `小丽-${vp}`, `student-task-${vp}`)
    await s.waitFor('!!document.querySelector("[data-assign-task-text]")', 15000, 'task workbench')
    await s.evaluate(`(() => { const el=document.querySelector('[data-assign-task-text]'); el.value='我在客厅找到了智能音箱、扫地机器人和智能台灯，还画下了它们的位置。'; el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
    await s.page.send('DOM.enable')
    const doc = await s.page.send('DOM.getDocument')
    const input = await s.page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-assign-task-file]' })
    await s.page.send('DOM.setFileInputFiles', { files: [photoPath], nodeId: input.nodeId })
    await s.waitFor('!!document.querySelector(".sbk-task-thumb img")', 8000, 'photo preview')
    await studentMetrics('task-workbench', `student-task-workbench-${vp}`)

    // 绘本创作台
    await s.clearCookies()
    await gate(story.token, `小强-${vp}`, `student-story-${vp}`)
    await s.waitFor('!!document.querySelector(".sbk-compose-grid")', 20000, 'compose')
    await studentMetrics('story-compose-top', `student-story-compose-${vp}`)
    const compose = await s.evaluate(`JSON.stringify((() => {
      const g=document.querySelector('.sbk-compose-grid'); const r=g.getBoundingClientRect();
      const steps=document.querySelector('.sbk-steps'); const sr=steps?steps.getBoundingClientRect():null;
      return {grid:{x:r.x,y:r.y,w:r.width,h:r.height}, cols:getComputedStyle(g).gridTemplateColumns,
        steps: sr?{x:sr.x,y:sr.y,w:sr.width,h:sr.height}:null, docW:document.documentElement.scrollWidth, vw:innerWidth}
    })())`)
    console.log(`  compose: ${compose}`)
    await s.evaluate(`document.querySelector('.sbk-stage-card')?.scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 400))
    await shot(s, `student-story-compose-stage-${vp}`)
    await s.evaluate(`document.querySelector('.sbk-steps')?.scrollIntoView({block:'start'}); true`)
    await new Promise((r) => setTimeout(r, 400))
    await shot(s, `student-story-compose-steps-${vp}`)
  }
  await studentBrowser.close()
  studentBrowser = null

  console.log('\n========== 清理 ==========')
  const del = await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  console.log('删除班级', del.status, del.text.slice(0, 100))
  classId = ''
  cleanupUser(API, EMAIL, NICK)
  console.log('账号已清理')
  const failed = reports.filter((r) => r.failures.length)
  console.log(`审计：${reports.length - failed.length}/${reports.length} 页面/主题检查通过，输出 ${output}`)
  if (failed.length) process.exitCode = 1
} catch (err) {
  reports.push({ name: 'runtime', failures: [err.message] })
  console.error('审计失败:', err)
  if (teacherBrowser) await teacherBrowser.close().catch(() => {})
  if (studentBrowser) await studentBrowser.close().catch(() => {})
  try {
    if (classId) await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  } catch (e) { console.error('清理班级失败:', e.message) }
  cleanupUser(API, EMAIL, NICK)
  process.exitCode = 1
}

writeFileSync(join(output, 'report.json'), JSON.stringify({ base: WEB, viewports, reports }, null, 2))
