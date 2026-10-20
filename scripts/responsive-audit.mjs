import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeClient, registerUser, cleanupUser } from './lib/kit.mjs'
import { launch } from './lib/cdp-kit.mjs'

const API = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const WEB = process.env.E2E_BASE || 'https://yuehua.online'
const EMAIL = '301@301.group'
const NICK = '响应式验收'
const PASSWORD = 'Resp-' + randomBytes(6).toString('hex')
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const tmp = mkdtempSync(join(tmpdir(), 'resp-audit-'))
const photoPath = join(tmp, 'photo.png')
writeFileSync(photoPath, Buffer.from(TINY_PNG.split(',')[1], 'base64'))

const teacher = makeClient(API)
const tcall = teacher.call
let classId = ''

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
  const names = ['小明', '小红', '小刚', '小美', '小丽', '小强', '欧阳娜娜']
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
  await sLab.call(`/api/assign/${lab.token}/verify`, { method: 'POST', body: { name: '小红' } })
  const labSub = await sLab.call(`/api/assign/${lab.token}/submit`, {
    method: 'POST',
    body: {
      kind: 'lab', labId: 'ai-senses', score: 88, note: '横屏验收：我学会了观察五官的位置。',
      work: { title: '五官配对记录', type: '互动练习', module: 'm1', grade: 'low', desc: '完成五官配对，得分 88。', hue: 200 },
    },
  })
  const sTask = makeStudent()
  await sTask.call(`/api/assign/${task.token}/verify`, { method: 'POST', body: { name: '小刚' } })
  const taskSub = await sTask.call(`/api/assign/${task.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '我找到了智能音箱、扫地机器人和智能台灯，并按位置画了下来。', images: [TINY_PNG] },
  })
  const sStory = makeStudent()
  await sStory.call(`/api/assign/${story.token}/verify`, { method: 'POST', body: { name: '小明' } })
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

const fmt = (n) => Math.round(n * 10) / 10

async function pageMetrics(p) {
  return JSON.parse(await p.evaluate(`JSON.stringify((() => {
    const vw = innerWidth, vh = innerHeight
    const visible = (el) => {
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0
    }
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1) } }
    const clipped = (el) => {
      let a = el.parentElement
      while (a && a !== document.body) {
        const s = getComputedStyle(a)
        if (s.overflowX !== 'visible' && a.getBoundingClientRect().right <= vw + 1) return true
        a = a.parentElement
      }
      return false
    }
    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea')].filter(visible).map((el) => ({
      tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 28),
      cls: String(el.className).slice(0, 60), disabled: !!el.disabled, ...rect(el),
    }))
    const small24 = controls.filter((c) => !c.disabled && (c.w < 24 || c.h < 24))
    const small44 = controls.filter((c) => !c.disabled && (c.w < 44 || c.h < 44))
    const offenders = [...document.querySelectorAll('body *')].filter(visible).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.right > vw + 1 && !clipped(el)
    }).slice(0, 10).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 70), ...rect(el) }))
    const fixed = [...document.querySelectorAll('body *')].filter(visible).map((el) => ({ el, s: getComputedStyle(el) }))
      .filter((x) => x.s.position === 'fixed' || x.s.position === 'sticky')
      .map(({ el, s }) => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), pos: s.position, z: s.zIndex, ...rect(el) }))
    const tableScroll = document.querySelector('.cls-table-scroll')
    const container = document.querySelector('.cls-container')
    const header = document.querySelector('header')
    return {
      vw, vh, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth,
      pageH: document.documentElement.scrollHeight,
      header: header ? rect(header) : null,
      container: container ? rect(container) : null,
      controls: controls.length,
      small24: small24.slice(0, 8), small24Count: small24.length,
      small44Count: small44.length,
      offenders,
      fixed,
      tableScroll: tableScroll ? { ...rect(tableScroll), scrollW: tableScroll.scrollWidth, clientW: tableScroll.clientWidth, overflowX: getComputedStyle(tableScroll).overflowX } : null,
      bodyPadBottom: getComputedStyle(document.body).paddingBottom,
    }
  })())`))
}

function summarize(label, m) {
  const issues = []
  if (m.docW > m.vw + 1) issues.push(`横向溢出 docW=${m.docW}>vw=${m.vw}`)
  if (m.header && m.container && m.container.y >= 0 && m.container.y < m.header.h - 1) issues.push(`容器被头部遮挡 y=${m.container.y}`)
  if (m.small24Count) issues.push(`触控目标<24px ${m.small24Count} 个`)
  if (m.offenders.length) issues.push(`越界元素 ${m.offenders.length} 个`)
  if (m.tableScroll && m.tableScroll.scrollW > m.tableScroll.clientW + 1) issues.push(`表格横向滚动 ${m.tableScroll.scrollW}/${m.tableScroll.clientW}`)
  console.log(`\n[${label}] ${m.vw}x${m.vh} docW=${m.docW} pageH=${m.pageH} 控件=${m.controls} <24=${m.small24Count} <44=${m.small44Count}`)
  if (m.header) console.log(`  header=${JSON.stringify(m.header)} container=${JSON.stringify(m.container)} bodyPadBottom=${m.bodyPadBottom}`)
  if (issues.length) console.log('  ⚠️ ' + issues.join(' | '))
  if (m.small24.length) console.log('  small24: ' + m.small24.map((c) => `${c.tag}:${c.text}[${c.w}x${c.h}]`).join(' ; '))
  if (m.offenders.length) console.log('  offenders: ' + JSON.stringify(m.offenders.slice(0, 5)))
  if (m.fixed.length) console.log('  fixed: ' + JSON.stringify(m.fixed.slice(0, 6)))
  if (m.tableScroll) console.log(`  tableScroll=${JSON.stringify(m.tableScroll)}`)
}

async function shot(p, name) {
  await p.screenshot(`/tmp/resp-${name}.png`)
}

async function auditPage(p, label, path, ready, name) {
  await p.goto(WEB + path, ready)
  await new Promise((r) => setTimeout(r, 500))
  const m = await pageMetrics(p)
  summarize(label, m)
  await shot(p, name)
  return m
}

let studentBrowser = null
try {
  const { lab, task, story } = await setup()
  console.log(`数据准备完成：班级=${classId}\n  lab=${lab.title}  task=${task.title}  story=${story.title}`)

  const teacherBrowser = await launch({ width: 1366, height: 768 })
  const p = teacherBrowser
  await p.setCookie('aiq_session', teacher.jar.replace(/^aiq_session=/, ''), WEB)
  const browser = teacherBrowser

  const viewports = [
    [1366, 768, '1366x768'],
    [1024, 768, '1024x768'],
    [844, 390, '844x390'],
    [768, 1024, '768x1024'],
    [390, 844, '390x844'],
  ]

  for (const [w, h, vp] of viewports) {
    await p.setViewport(w, h)
    console.log(`\n========== 教师端 ${vp} ==========`)
    await auditPage(p, 'class-list', `/#/me/classes`, '!!document.querySelector(".cls-grid")', `teacher-list-${vp}`)

    await auditPage(p, 'class-detail-top', `/#/me/classes/${classId}`, '!!document.querySelector("[data-cls-root] form[data-form=\\"create-assignment\\"]")', `teacher-class-${vp}`)
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
  }
  await browser.close()
  console.log('\n教师端截图完成')

  // ── 学生端 ───────────────────────────────────────────────
  studentBrowser = await launch({ width: 1366, height: 768 })
  const s = studentBrowser

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
    const setVal = (sel, v) => `(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.value=${JSON.stringify(v)}; el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`
    await s.evaluate(setVal('#sbk-assign-name', name))
    await s.evaluate('document.querySelector(\'form[data-assign-form] button[type="submit"]\').click()')
  }

  for (const [w, h, vp] of viewports) {
    await s.setViewport(w, h)
    await s.clearCookies()
    console.log(`\n========== 学生端 ${vp} ==========`)

    // 互动练习：入口 → 练习 → 监考条 → 回作业
    await gate(lab.token, '小美', `student-lab-${vp}`)
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
    await gate(task.token, '小丽', `student-task-${vp}`)
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
    await gate(story.token, '小强', `student-story-${vp}`)
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
} catch (err) {
  console.error('审计失败:', err)
  if (studentBrowser) await studentBrowser.close().catch(() => {})
  try {
    if (classId) await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  } catch (e) { console.error('清理班级失败:', e.message) }
  cleanupUser(API, EMAIL, NICK)
  process.exitCode = 1
}
