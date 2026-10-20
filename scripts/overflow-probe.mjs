import { randomBytes } from 'node:crypto'
import { makeClient, registerUser, cleanupUser } from './lib/kit.mjs'
import { launch } from './lib/cdp-kit.mjs'

const API = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const WEB = process.env.E2E_BASE || 'https://yuehua.online'
const EMAIL = '301@301.group'
const NICK = '溢出探针'
const PASSWORD = 'Probe-' + randomBytes(6).toString('hex')
const teacher = makeClient(API)
const tcall = teacher.call
let classId = ''

cleanupUser(API, EMAIL, NICK)
try {
  await registerUser(teacher, { email: EMAIL, password: PASSWORD, nickname: NICK })
  const cls = await tcall('/api/classes', { method: 'POST', body: { name: '溢出探针班' } })
  classId = cls.json?.class?.id
  await tcall(`/api/classes/${classId}/members`, {
    method: 'POST',
    body: { names: ['小明', '小红', '小刚', '小美', '小丽', '小强', '欧阳娜娜'] },
  })
  const mk = async (body) => {
    const r = await tcall(`/api/classes/${classId}/assignments`, { method: 'POST', body })
    if (r.status !== 200) throw new Error(r.text)
    return r.json.assignment.id
  }
  await mk({ title: 'AI 的五官配对', type: 'lab', labId: 'ai-senses', instructions: '完成五官配对练习，尽量拿满分。' })
  await mk({ title: '提示词拆解', type: 'task', moduleId: 'm2', stage: 'mid', activity: '提示词拆解', toolLabId: 'prompt-builder', instructions: '观察家里的智能设备。' })
  await mk({ title: '溢出探针绘本', type: 'storybook', instructions: '完成一页绘本并提交。' })

  const browser = await launch({ width: 390, height: 844 })
  const p = browser
  await p.setCookie('aiq_session', teacher.jar.replace(/^aiq_session=/, ''), WEB)
  await p.setViewport(390, 844)

  await p.goto(`${WEB}/#/me/classes`, '!!document.querySelector(".cls-grid")')
  console.log('list innerWidth:', await p.evaluate('innerWidth'), 'docW:', await p.evaluate('document.documentElement.scrollWidth'))

  await p.goto(`${WEB}/#/me/classes/${classId}`, '!!document.querySelector("[data-cls-root] form[data-form=\\"create-assignment\\"]")')
  await new Promise((r) => setTimeout(r, 800))
  console.log('detail innerWidth:', await p.evaluate('innerWidth'), 'docW:', await p.evaluate('document.documentElement.scrollWidth'))
  const out = await p.evaluate(`JSON.stringify((() => {
    const vw = 390
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1) } }
    const vis = (el) => { const s=getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0 }
    const clipped = (el) => { let a=el.parentElement; while(a&&a!==document.body){const s=getComputedStyle(a); if(s.overflowX!=='visible'&&a.getBoundingClientRect().right<=vw+1)return true; a=a.parentElement} return false }
    const all = [...document.querySelectorAll('body *')].filter(vis)
    const over = all.filter((el) => { const r=el.getBoundingClientRect(); return r.width>0 && r.right>vw+1 && !clipped(el) })
      .map((el) => ({ tag:el.tagName, cls:String(el.className).slice(0,80), ...rect(el), sw:el.scrollWidth, cw:el.clientWidth, minW:getComputedStyle(el).minWidth, ws:getComputedStyle(el).whiteSpace }))
    // deepest offenders: those whose children all fit or no children overflow
    const deepest = over.filter((o) => !over.some((q) => q !== o && q.x >= o.x - 0.5 && q.right <= o.right + 0.5 && q.tag !== o.tag))
    const cards = [...document.querySelectorAll('.cls-card')].map((el) => ({ cls:String(el.className), ...rect(el), sw:el.scrollWidth, cw:el.clientWidth }))
    const grid = document.querySelector('.cls-detail-grid')
    const cs = grid ? getComputedStyle(grid) : null
    return { innerW: innerWidth, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth,
      over: over.slice(0, 25), deepest: deepest.slice(0, 15), cards,
      grid: grid ? { ...rect(grid), cols: cs.gridTemplateColumns, minW: cs.minWidth } : null,
      container: (() => { const c=document.querySelector('.cls-container'); return c?{...rect(c),cw:c.clientWidth,sw:c.scrollWidth}:null })() }
  })())`)
  console.log(JSON.stringify(JSON.parse(out), null, 2))
  await p.screenshot('/tmp/overflow-probe-390.png')
  await browser.close()
} finally {
  try { if (classId) await tcall(`/api/classes/${classId}`, { method: 'DELETE' }) } catch {}
  cleanupUser(API, EMAIL, NICK)
}
