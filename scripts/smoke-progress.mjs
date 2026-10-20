#!/usr/bin/env node
/**
 * 学习进度冒烟测试。
 *
 *   node scripts/smoke-progress.mjs
 *
 * 环境变量：SMOKE_BASE / SMOKE_EMAIL / SMOKE_KEEP，同 smoke-auth.mjs
 *
 * 最要紧的一组断言是「并发取高分」：进度写入用的是
 * `INSERT ... ON DUPLICATE KEY UPDATE`，就是为了消掉「先读后写」在并发下
 * 丢高分的窗口。这个性质光看代码看不出来，必须真的并发打进去验。
 *
 * 会真的发一封验证码邮件（注册测试账号用），跑完自动清理。
 */
import { randomBytes } from 'node:crypto'
import {
  makeChecker,
  makeClient,
  cleanupUser,
  mysql,
  registerUser,
} from './lib/kit.mjs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const EMAIL = process.env.SMOKE_EMAIL || '301@301.group'
const KEEP = process.env.SMOKE_KEEP === '1'
const PASSWORD = 'Prog-' + randomBytes(6).toString('hex')
const NICKNAME = '进度冒烟'

const { check, summary } = makeChecker()
const client = makeClient(BASE)
const call = client.call

const putLab = (labId, body) =>
  call(`/api/progress/labs/${encodeURIComponent(labId)}`, { method: 'PUT', body })
const getProgress = () => call('/api/progress')

function shuffle(a) {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

console.log(`\n进度冒烟测试 @ ${BASE}   邮箱=${EMAIL}\n`)

cleanupUser(BASE, EMAIL, NICKNAME) // 清掉上一轮残留，保证可重复运行

// ══ 未登录 ══════════════════════════════════════════════════
console.log('【未登录一律 401】')
{
  client.clearJar()
  const g = await getProgress()
  check('GET /progress 未登录 → 401', g.status === 401, `${g.status} ${g.text.slice(0, 100)}`)

  const p = await putLab('quiz-arena', { done: true, score: 90 })
  check('PUT /progress/labs/:id 未登录 → 401', p.status === 401, String(p.status))

  const q = await call('/api/progress/quiz', { method: 'PUT', body: { score: 90 } })
  check('PUT /progress/quiz 未登录 → 401', q.status === 401, String(q.status))

  const d = await call('/api/progress', { method: 'DELETE' })
  check('DELETE /progress 未登录 → 401', d.status === 401, String(d.status))

  const i = await call('/api/progress/import', { method: 'POST', body: {} })
  check('POST /progress/import 未登录 → 401', i.status === 401, String(i.status))
}

// ══ 注册测试账号 ════════════════════════════════════════════
console.log('\n【注册测试账号】')
const user = await registerUser(client, { email: EMAIL, password: PASSWORD, nickname: NICKNAME })
check('注册成功并已登录', !!user?.id, JSON.stringify(user))

// ══ 基础读写 ════════════════════════════════════════════════
console.log('\n【基础读写】')
{
  const empty = await getProgress()
  check(
    '新账号进度为空',
    empty.status === 200 && Object.keys(empty.json?.labs ?? {}).length === 0 && empty.json?.quizBest === 0,
    empty.text.slice(0, 140),
  )

  const r1 = await putLab('quiz-arena', { done: true, score: 60, note: '第一次' })
  check(
    'PUT 建记录并回传权威值',
    r1.status === 200 && r1.json?.lab?.done === true && r1.json?.lab?.score === 60 && r1.json?.lab?.note === '第一次',
    `${r1.status} ${r1.text.slice(0, 160)}`,
  )
  check(
    '回传带 ISO 格式 updatedAt',
    typeof r1.json?.lab?.updatedAt === 'string' && !Number.isNaN(Date.parse(r1.json.lab.updatedAt)),
    String(r1.json?.lab?.updatedAt),
  )

  const r2 = await putLab('quiz-arena', { score: 40 })
  check('更低分不覆盖（取 max）', r2.json?.lab?.score === 60, String(r2.json?.lab?.score))
  check('只传分数时 done 保持 true（单调）', r2.json?.lab?.done === true, String(r2.json?.lab?.done))
  check('只传分数时 note 保留', r2.json?.lab?.note === '第一次', String(r2.json?.lab?.note))

  const r3 = await putLab('quiz-arena', { score: 90 })
  check('更高分才覆盖', r3.json?.lab?.score === 90, String(r3.json?.lab?.score))

  const r4 = await putLab('quiz-arena', { done: true })
  check('不传分数时分数不变', r4.json?.lab?.score === 90, String(r4.json?.lab?.score))

  const r5 = await putLab('quiz-arena', { note: '改过了' })
  check('新 note 覆盖旧 note', r5.json?.lab?.note === '改过了', String(r5.json?.lab?.note))

  const g = await getProgress()
  check(
    'GET 能读回全部记录',
    g.json?.labs?.['quiz-arena']?.done === true && g.json?.labs?.['quiz-arena']?.score === 90,
    JSON.stringify(g.json).slice(0, 160),
  )
}

// ══ 并发取高分（核心）═══════════════════════════════════════
console.log('\n【并发取高分 —— 原子性验证】')
{
  const rounds = []
  let allOk = true
  for (let round = 0; round < 4; round++) {
    const labId = `race-${round}`
    // 20 个请求同时打进去，分数 5..100 乱序。
    // 先读后写的实现里，它们会读到同一个旧值再各自覆盖，末值大概率不是 100。
    const scores = shuffle(Array.from({ length: 20 }, (_, i) => (i + 1) * 5))
    await Promise.all(scores.map((s) => putLab(labId, { done: true, score: s })))

    const got = await getProgress()
    const rec = got.json?.labs?.[labId]
    rounds.push(`${labId}:${rec?.score}`)
    if (rec?.score !== 100) allOk = false
  }
  check('4 轮 × 20 并发写不同分数，最终都留下 100', allOk, rounds.join('  '))
}

// ══ 挑战赛最好成绩 ══════════════════════════════════════════
console.log('\n【知识挑战赛最好成绩】')
{
  const a = await call('/api/progress/quiz', { method: 'PUT', body: { score: 70 } })
  check('首次写入 70', a.json?.quizBest === 70, String(a.json?.quizBest))

  const b = await call('/api/progress/quiz', { method: 'PUT', body: { score: 50 } })
  check('更低分不覆盖（取 max）', b.json?.quizBest === 70, String(b.json?.quizBest))

  const c = await call('/api/progress/quiz', { method: 'PUT', body: { score: 100 } })
  check('更高分覆盖为 100', c.json?.quizBest === 100, String(c.json?.quizBest))

  const me = await call('/api/auth/me')
  check('quizBest 同步反映在 /auth/me 上', me.json?.user?.quizBest === 100, String(me.json?.user?.quizBest))
}

// ══ 旧数据导入 ══════════════════════════════════════════════
console.log('\n【旧 localStorage 导入】')
{
  const r = await call('/api/progress/import', {
    method: 'POST',
    body: {
      labs: {
        // 已有 90 分，导入 30 分——必须保持 90（合并而非覆盖）
        'quiz-arena': { done: true, score: 30 },
        // 全新的一条，必须建出来
        'storybook': { done: true, score: 55, note: '本机记录' },
      },
      quizBest: 40, // 当前 100，必须保持 100
      works: [
        { title: '我的第一张 AI 画', author: '本机乱填的名字', grade: 'low', module: 'm1', type: '绘画', desc: '一只猫', hue: 200 },
      ],
    },
  })
  check('导入接口返回成功', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`)
  check('报告导入了 2 条训练', r.json?.importedLabs === 2, JSON.stringify(r.json))
  check('报告导入了 1 份作品', r.json?.importedWorks === 1, JSON.stringify(r.json))

  const g = await getProgress()
  check('已存在的训练不被低分覆盖（合并语义）', g.json?.labs?.['quiz-arena']?.score === 90, String(g.json?.labs?.['quiz-arena']?.score))
  check('新训练被建出来', g.json?.labs?.['storybook']?.score === 55, JSON.stringify(g.json?.labs?.['storybook']))
  check('quizBest 不被更低的导入值覆盖', g.json?.quizBest === 100, String(g.json?.quizBest))

  const works = mysql(`SELECT title, author, \`description\` FROM works WHERE userId='${user.id}'`).trim()
  check('作品已落库', works.includes('我的第一张 AI 画'), works.slice(0, 120))
  check('作品作者强制用账号昵称（不信任本机填的名字）', works.includes(NICKNAME) && !works.includes('本机乱填'), works.slice(0, 120))
}

// ══ 参数校验 ════════════════════════════════════════════════
console.log('\n【参数校验】')
{
  const badId = await call('/api/progress/labs/%20bad%20id', { method: 'PUT', body: { done: true } })
  check('非法训练编号被拒（400）', badId.status === 400, `${badId.status} ${badId.text.slice(0, 120)}`)

  const noBody = await putLab('quiz-arena', {})
  check('空 patch 被拒（400）', noBody.status === 400, `${noBody.status} ${noBody.text.slice(0, 120)}`)

  const neg = await putLab('quiz-arena', { score: -1 })
  check('负分被拒（400）', neg.status === 400, `${neg.status} ${neg.text.slice(0, 120)}`)

  const huge = await putLab('quiz-arena', { score: 999999 })
  check('超大分数被拒（400）', huge.status === 400, `${huge.status} ${huge.text.slice(0, 120)}`)

  const str = await putLab('quiz-arena', { score: '90' })
  check('字符串分数被拒（不做隐式转换）', str.status === 400, `${str.status} ${str.text.slice(0, 120)}`)

  const longNote = await putLab('quiz-arena', { note: 'x'.repeat(501) })
  check('超长备注被拒（400）', longNote.status === 400, `${longNote.status} ${longNote.text.slice(0, 120)}`)
}

// ══ 清空 ════════════════════════════════════════════════════
console.log('\n【清空进度】')
{
  const d = await call('/api/progress', { method: 'DELETE' })
  check('DELETE 返回空进度', d.status === 200 && Object.keys(d.json?.labs ?? {}).length === 0, d.text.slice(0, 140))

  const g = await getProgress()
  check('清空后 GET 确实是空的', Object.keys(g.json?.labs ?? {}).length === 0 && g.json?.quizBest === 0, JSON.stringify(g.json).slice(0, 140))
}

if (!KEEP) {
  cleanupUser(BASE, EMAIL, NICKNAME)
  console.log('\n已清理测试账号和临时数据。')
} else {
  console.log(`\n保留了测试账号 ${EMAIL} / ${PASSWORD}`)
}

process.exit(summary() === 0 ? 0 : 1)
