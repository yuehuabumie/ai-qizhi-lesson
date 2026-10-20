#!/usr/bin/env node
/**
 * 班级作业浏览器验收：教师建三类作业 + 学生完成三类作业。
 *
 *   E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
 *     node scripts/assign-ui-e2e.mjs
 *
 * 页面必须使用本站域名（127.0.0.1 的 nginx 默认站点属于其他项目）。
 * 会真的发一封验证码邮件；测试数据在结束时删除。
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker, makeClient, registerUser, cleanupUser } from './lib/kit.mjs'
import { launch } from './lib/cdp-kit.mjs'

const WEB = process.env.E2E_BASE || 'https://yuehua.online'
const API = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const EMAIL = process.env.ASSIGN_E2E_EMAIL || '301@301.group'
const NICKNAME = '作业界面验收'
const PASSWORD = 'AssignUI-' + randomBytes(6).toString('hex')

const { check, summary } = makeChecker()
const teacher = makeClient(API)
const tcall = teacher.call

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const tmp = mkdtempSync(join(tmpdir(), 'assign-ui-'))
const photoPath = join(tmp, 'photo.png')
writeFileSync(photoPath, TINY_PNG)

let classId = ''
let browser = null

const setValue = (selector, value, eventName = 'input') => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  el.value = ${JSON.stringify(value)}
  el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }))
  return true
})()`

function formSelect(name, value) {
  return `(() => {
    const el = document.querySelector('form[data-form="create-assignment"] [name="${name}"]')
    if (!el) return false
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value === ${JSON.stringify(value)}
  })()`
}

async function cleanup() {
  try {
    if (classId) await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  } catch (err) {
    console.error('  ⚠️  清理班级失败:', err.message)
  }
  cleanupUser(API, EMAIL, NICKNAME)
}

console.log(`\n班级作业界面验收  页面=${WEB}  接口=${API}\n`)
cleanupUser(API, EMAIL, NICKNAME)

try {
  await registerUser(teacher, { email: EMAIL, password: PASSWORD, nickname: NICKNAME })
  const cls = await tcall('/api/classes', { method: 'POST', body: { name: '界面验收班' } })
  classId = cls.json?.class?.id || ''
  await tcall(`/api/classes/${classId}/members`, {
    method: 'POST',
    body: { names: ['小明', '小红', '小刚'] },
  })
  check('准备测试教师、班级与名单', !!classId)

  browser = await launch({ width: 1366, height: 900 })
  const p = browser
  const cookieVal = teacher.jar.replace(/^aiq_session=/, '')
  await p.setCookie('aiq_session', cookieVal, new URL(WEB).origin)

  console.log('\n【教师端：从表单创建三类作业】')
  await p.goto(`${WEB}/#/me/classes/${classId}`, '!!document.querySelector("[data-cls-root] form[data-form=\\"create-assignment\\"]")')

  // 互动练习：切类型 → 选练习，标题自动带出
  check('切到互动练习后显示练习选择', await p.evaluate(formSelect('type', 'lab')))
  check('选择练习 ai-senses', await p.evaluate(formSelect('labId', 'ai-senses')))
  check(
    '练习标题自动填入作业名称',
    await p.evaluate('document.querySelector(\'[name="title"]\').value === "AI 的五官配对"'),
    await p.evaluate('document.querySelector(\'[name="title"]\').value'),
  )
  await p.evaluate('document.querySelector(\'form[data-form="create-assignment"] button[type="submit"]\').click()')
  await p.waitFor('!!document.querySelector("#cls-share-url")', 20_000, '互动练习详情页')
  check('互动练习作业创建后跳到详情页', true)
  await p.evaluate(`window.location.hash = '#/me/classes/${classId}'; true`)
  await p.waitFor('!!document.querySelector("form[data-form=\\"create-assignment\\"]")', 20_000, '返回班级页')

  // 课程任务：模块/学段联动活动与工具台，标题自动带出
  await p.evaluate(formSelect('type', 'task'))
  check('切到课程任务后显示模块选择', await p.evaluate('!!document.querySelector(\'[name="moduleId"]\')'))
  await p.evaluate(`(() => {
    const f = document.querySelector('form[data-form="create-assignment"]')
    f.querySelector('[name="moduleId"]').value = 'm2'
    f.querySelector('[name="stage"]').value = 'mid'
    f.querySelector('[name="moduleId"]').dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  check(
    '模块/学段联动出活动选项',
    await p.evaluate('document.querySelector(\'[name="activity"]\').options.length > 0'),
  )
  check('选择活动「提示词拆解」', await p.evaluate(formSelect('activity', '提示词拆解')))
  check(
    '活动标题自动填入作业名称',
    await p.evaluate('document.querySelector(\'[name="title"]\').value === "提示词拆解"'),
    await p.evaluate('document.querySelector(\'[name="title"]\').value'),
  )
  check('选择配套工具台 prompt-builder', await p.evaluate(formSelect('toolLabId', 'prompt-builder')))
  await p.evaluate('document.querySelector(\'form[data-form="create-assignment"] button[type="submit"]\').click()')
  await p.waitFor('!!document.querySelector("#cls-share-url")', 20_000, '课程任务详情页')
  check('课程任务创建后跳到详情页', true)
  await p.evaluate(`window.location.hash = '#/me/classes/${classId}'; true`)
  await p.waitFor('!!document.querySelector("form[data-form=\\"create-assignment\\"]")', 20_000, '返回班级页')

  // 绘本：手填名称与说明
  await p.evaluate(formSelect('type', 'storybook'))
  await p.evaluate(setValue('[name="title"]', '界面验收绘本'))
  await p.evaluate(setValue('[name="instructions"]', '完成一页绘本并提交。'))
  await p.evaluate('document.querySelector(\'form[data-form="create-assignment"] button[type="submit"]\').click()')
  await p.waitFor('!!document.querySelector("#cls-share-url")', 20_000, '绘本详情页')
  check('绘本作业创建后跳到详情页', true)
  await p.evaluate(`window.location.hash = '#/me/classes/${classId}'; true`)
  await p.waitFor('!!document.querySelector("form[data-form=\\"create-assignment\\"]")', 20_000, '返回班级页')

  const cards = await p.evaluate(`Array.from(document.querySelectorAll('.cls-assign-item')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())`)
  check('班级页出现三张作业卡片', cards.length === 3, JSON.stringify(cards))
  check(
    '卡片写明作业类型、课程任务与工具台',
    cards.some((t) => t.includes('互动练习') && t.includes('AI 的五官配对')) &&
      cards.some((t) => t.includes('课程任务') && t.includes('提示词拆解') && t.includes('工具台：提示词魔法工坊')) &&
      cards.some((t) => t.includes('AI 绘本创作') && t.includes('界面验收绘本')),
    JSON.stringify(cards),
  )
  await p.screenshot('/tmp/assign-ui-teacher-class.png')

  console.log('\n【学生端：互动练习监考与刷新恢复】')
  const classDetail = await tcall(`/api/classes/${classId}`)
  const assignList = classDetail.json?.class?.assignments ?? []
  const detailList = await Promise.all(
    assignList.map((a) => tcall(`/api/classes/${classId}/assignments/${a.id}`)),
  )
  const byTitle = new Map(detailList.map((r) => [r.json?.assignment?.title, r.json?.assignment]))
  const labA = byTitle.get('AI 的五官配对')
  const taskA = byTitle.get('提示词拆解')
  const storyA = byTitle.get('界面验收绘本')
  check('接口取到三份作业与链接 token', !!labA?.token && !!taskA?.token && !!storyA?.token)

  await p.clearCookies()
  await p.goto(`${WEB}/#/assign/${labA.token}`, '!!document.querySelector("form[data-assign-form]")')
  check('学生打开发练习链接看到姓名核对页', await p.evaluate('document.body.textContent.includes("输入你的姓名")'))
  await p.evaluate(`document.querySelector('form[data-assign-form] button[type="submit"]').click()`)
  check('空姓名提示并聚焦输入框', await p.evaluate(`document.querySelector('#sbk-assign-name-error').textContent.includes('请先输入') && document.activeElement.id === 'sbk-assign-name'`))
  await p.evaluate(setValue('#sbk-assign-name', '不在名单内的同学'))
  await p.evaluate(`document.querySelector('form[data-assign-form] button[type="submit"]').click()`)
  await p.waitFor(`!!document.querySelector('#sbk-assign-name-error')?.textContent.trim()`, 10000, '姓名不匹配提示')
  check('姓名不匹配保留输入并关联错误提示', await p.evaluate(`document.querySelector('#sbk-assign-name').value === '不在名单内的同学' && document.querySelector('#sbk-assign-name').getAttribute('aria-invalid') === 'true'`))
  await p.evaluate(setValue('#sbk-assign-name', '小红'))
  await p.evaluate('document.querySelector("form[data-assign-form] button[type=\\"submit\\"]").click()')
  await p.waitFor('!!document.querySelector(\'[data-act="assign-open-lab"]\')', 20_000, '互动练习工作台')
  check('核对名单后进入互动练习工作台', true)

  await p.evaluate('document.querySelector(\'[data-act="assign-open-lab"]\').click()')
  await p.waitFor('location.hash.includes("/lab/ai-senses")', 20_000, '进入练习页')
  await p.waitFor('!!document.querySelector("[data-sbk-supervisor]") && getComputedStyle(document.querySelector("[data-sbk-supervisor]")).display !== "none"', 20_000, '监考浮条')
  check('打开练习后出现监考浮条', true)

  const captured = await p.evaluate(`(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const app = pinia._s.get('app')
    return app.markLab('ai-senses', 91)
  })()`)
  check('练习完成回调被监考捕获', captured === true, String(captured))
  await p.waitFor('document.querySelector("[data-sbk-supervisor]").textContent.includes("本次成绩 91 分")', 10_000, '浮条显示成绩')
  check('浮条显示本次成绩', true)

  await p.goto(`${WEB}/#/lab/ai-senses?assign=${labA.token}`, '!!document.querySelector("[data-sbk-supervisor]")')
  await p.waitFor('document.querySelector("[data-sbk-supervisor]").textContent.includes("本次成绩 91 分")', 20_000, '刷新后恢复成绩')
  check('刷新后深链恢复作业会话与成绩', true)

  await p.evaluate('document.querySelector(".sbk-supervisor-submit").click()')
  await p.waitFor('location.hash.startsWith("#/assign/")', 20_000, '提交后回作业页')
  await p.waitFor(
    '!!document.querySelector(".sbk-submitted") && document.body.textContent.includes("作业已提交") && document.querySelector(".sbk-assign-scorebox strong")?.textContent.trim().startsWith("91")',
    20_000,
    '已提交页',
  )
  check('浮条提交成绩后回到已提交页', true)
  await p.screenshot('/tmp/assign-ui-lab-submitted.png')

  console.log('\n【学生端：课程任务文字 + 照片】')
  await p.goto(`${WEB}/#/assign/${taskA.token}`, '!!document.querySelector("form[data-assign-form]")')
  check('课程任务入口显示任务名称', await p.evaluate('document.body.textContent.includes("提示词拆解")'))
  await p.evaluate(setValue('#sbk-assign-name', '小刚'))
  await p.evaluate('document.querySelector("form[data-assign-form] button[type=\\"submit\\"]").click()')
  await p.waitFor('!!document.querySelector("[data-assign-task-text]")', 20_000, '课程任务工作台')
  check('进入课程任务工作台并显示配套工具台', await p.evaluate('!!document.querySelector(\'[data-act="assign-open-tool"]\')'))

  await p.evaluate(setValue('[data-assign-task-text]', '界面验收：我找到智能音箱和扫地机器人。'))
  check(
    '输入文字后计数更新',
    await p.evaluate('document.querySelector("[data-assign-task-count]").textContent.startsWith("19")'),
    await p.evaluate('document.querySelector("[data-assign-task-count]").textContent'),
  )

  await p.page.send('DOM.enable')
  const doc = await p.page.send('DOM.getDocument')
  const input = await p.page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '[data-assign-task-file]',
  })
  await p.page.send('DOM.setFileInputFiles', { files: [photoPath], nodeId: input.nodeId })
  await p.waitFor('!!document.querySelector(".sbk-task-thumb img")', 10_000, '照片预览')
  check('照片选择后出现预览缩略图', true)

  await p.evaluate('document.querySelector(\'[data-act="assign-task-submit"]\').click()')
  await p.waitFor(
    '!!document.querySelector(".sbk-submitted") && document.querySelector(".sbk-submit-text")?.textContent.includes("界面验收：我找到智能音箱") && !!document.querySelector(".sbk-task-photos.is-readonly img")',
    20_000,
    '课程任务已提交页',
  )
  check('课程任务提交后展示文字与照片', true)
  await p.screenshot('/tmp/assign-ui-task-submitted.png')

  console.log('\n【学生端：绘本作业进入创作台】')
  await p.goto(`${WEB}/#/assign/${storyA.token}`, '!!document.querySelector("form[data-assign-form]")')
  await p.evaluate(setValue('#sbk-assign-name', '小明'))
  await p.evaluate('document.querySelector("form[data-assign-form] button[type=\\"submit\\"]").click()')
  await p.waitFor('!!document.querySelector(".sbk-compose-grid") && !!document.querySelector(".sbk-crumbs-assign")', 20_000, '绘本作业创作台')
  check('绘本作业进入创作台且带班级作业面包屑', true)
  check(
    '创作台显示 AI 生成剩余次数',
    await p.evaluate('document.body.textContent.includes("AI 生成剩余")'),
  )
  check(
    '作业模式三步为编排/生成/审查提交',
    await p.evaluate('document.body.textContent.includes("审查提交")'),
  )
  await p.screenshot('/tmp/assign-ui-storybook-compose.png')

  console.log('\n【学生端：真实生成插画 → 审查 → 提交】')
  for (const [field, value] of Object.entries({ who: '李白', where: '窗前', doing: '抬头望月亮' })) {
    await p.evaluate(setValue(`[data-field="${field}"]`, value))
  }
  await p.evaluate(`document.querySelector('[data-act="generate"]').click()`)
  await p.waitFor('!!document.querySelector(".sbk-review")', 180_000, '真实插画生成与成书审查')
  check('真实插画生成后进入成书审查', await p.evaluate(`!!document.querySelector('.sbk-review img[src]')`))
  check('未确认审查时禁止提交', await p.evaluate(`document.querySelector('[data-act="submit"]').disabled`))
  await p.evaluate(`document.querySelector('[data-check="review"]').click()`)
  await p.evaluate(`document.querySelector('[data-act="submit"]').click()`)
  await p.waitFor('!!document.querySelector(".sbk-submitted")', 30_000, '绘本已提交')
  check('绘本通过审查后提交并展示成书', await p.evaluate(`document.body.textContent.includes('作业已提交') && !!document.querySelector('.sbk-submitted img')`))
  await p.screenshot('/tmp/assign-ui-storybook-submitted.png')

  console.log('\n【教师端：预览学生绘本 → 发布展厅 → 撤下】')
  await p.clearCookies()
  await p.setCookie('aiq_session', cookieVal, new URL(WEB).origin)
  await p.goto(`${WEB}/#/me/classes/${classId}/assignments/${storyA.id}`, '!!document.querySelector(".cls-table-card")')
  await p.evaluate(`document.querySelector('[data-act="open-submission"]').focus(); document.querySelector('[data-act="open-submission"]').click()`)
  await p.waitFor('!!document.querySelector("[data-act=\\"publish-submission-confirm\\"]")', 15_000, '绘本预览')
  check('教师预览显示学生真实插画', await p.evaluate(`!!document.querySelector('.cls-page-art img')`))
  await p.evaluate(`document.querySelector('[data-act="publish-submission-confirm"]').click()`)
  await p.waitFor('!document.querySelector(".cls-modal") && !!document.querySelector(".cls-chip.is-published")', 15_000, '发布展厅')
  check('教师通过界面发布学生绘本', true)
  await p.evaluate(`document.querySelector('[data-act="open-submission"]').click()`)
  await p.waitFor('!!document.querySelector("[data-act=\\"unpublish-submission\\"]")', 15_000, '已发布预览')
  check('再次打开预览显示已发布状态', await p.evaluate(`!!document.querySelector('.cls-published-note')`))
  await p.evaluate(`window.confirm = () => true; document.querySelector('[data-act="unpublish-submission"]').click()`)
  await p.waitFor('!document.querySelector(".cls-modal") && !document.querySelector(".cls-chip.is-published")', 15_000, '撤下展厅')
  check('撤下展厅后保留学生提交', await p.evaluate(`!!document.querySelector('[data-act="open-submission"]:not([disabled])')`))

  console.log('\n【学生端：关闭与失效链接】')
  await p.evaluate(`document.querySelector('[data-act="toggle-assignment"]').click()`)
  await p.waitFor(`document.querySelector('[data-act="toggle-assignment"]')?.textContent.includes('重新开放')`, 15000, '关闭作业')
  await p.clearCookies()
  await p.goto(`${WEB}/#/assign/${storyA.token}`, `document.body.textContent.includes('这份作业已经关闭')`)
  check('已关闭作业显示原因和重新检查按钮', await p.evaluate(`!!document.querySelector('[data-act="assign-retry"]') && !document.querySelector('form[data-assign-form]')`))
  const invalidToken = (storyA.token[0] === 'a' ? 'b' : 'a') + storyA.token.slice(1)
  await p.goto(`${WEB}/#/assign/${invalidToken}`, `!!document.querySelector('.sbk-assign-badge.is-error')`)
  check('失效链接显示可恢复的错误页面', await p.evaluate(`document.body.textContent.includes('作业打不开') && !!document.querySelector('[data-act="assign-retry"]')`))

  console.log('\n【清理】')
  const del = await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  check('删除测试班级', del.status === 200, del.text.slice(0, 120))
  classId = ''
  cleanupUser(API, EMAIL, NICKNAME)
  check('测试账号已清理', true)
} catch (err) {
  console.error('\n界面验收异常：', err)
  await cleanup()
  process.exitCode = 1
}

if (browser) await browser.close()
const failed = summary()
if (failed) process.exitCode = 1
