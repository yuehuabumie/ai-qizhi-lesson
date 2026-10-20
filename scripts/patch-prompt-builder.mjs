#!/usr/bin/env node
/**
 * 给「提示词魔法工坊」的**构建产物**打「真实 AI 出图」补丁。
 *
 * 为什么是补丁而不是改源码：前端源码不在服务器上（见 HANDOFF §5/§6），
 * 服务器只有 Vite 构建产物。此脚本在 site/assets 里定位 PromptBuilder 组件，
 * 把本地假图逻辑换成调用后端 /api/ai/image 的真实出图。
 *
 * 缓存失效用查询串而不是改文件名：入口 chunk 同时是 17 个视图 chunk 的
 * **共享依赖**（`import{...}from"./index-xxx.js"`）。只给入口/组件换新文件名，
 * 视图 chunk 仍会拉起旧入口，浏览器里出现两份 Vue 实例，整个 SPA 不挂载。
 * 所以这里保留所有文件名，给**每个 chunk 的全部 `./xxx.js` 引用**统一追加
 * `?v=<内容哈希>`；index.html 里的入口也带同一个版本串。nginx 把查询串视为
 * 不同 URL，immutable 缓存自然被绕开，而模块图内部 URL 完全一致、只有一份实例。
 *
 * ⚠️ 重新构建并部署前端会覆盖本补丁。届时的正解是把同样改动移植到开发机
 * 源码（PromptBuilder 的生成函数 + 候选图渲染），或重新执行本脚本。
 * 脚本对锚点字符串做全量匹配，源码变了一处就整个失败，不会打歪。
 *
 * 用法（需要写 site/ 的权限）：
 *   sudo node scripts/patch-prompt-builder.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chownSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, 'site')
const assets = join(site, 'assets')

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}
const hash8 = (s) => createHash('sha256').update(s).digest('base64url').slice(0, 8)

// ── 定位入口与 LabPlayView chunk ────────────────────────────
const htmlPath = join(site, 'index.html')
let html = readFileSync(htmlPath, 'utf8')
const entryName = html.match(/assets\/(index-[\w-]+\.js)(?:\?v=[\w-]+)?/)?.[1]
if (!entryName) fail('index.html 里找不到入口 chunk')

const entryPath = join(assets, entryName)
const entry = readFileSync(entryPath, 'utf8')
const labNames = [...new Set(entry.match(/LabPlayView-[\w-]+\.js/g) ?? [])]
if (labNames.length !== 1) fail(`入口里 LabPlayView 引用不唯一：${labNames.join(', ') || '（没有）'}`)
const labName = labNames[0]
const labPath = join(assets, labName)
let lab = readFileSync(labPath, 'utf8')

const htmlVersioned = /assets\/index-[\w-]+\.js\?v=/.test(html)
if (lab.includes('aiImgs') && htmlVersioned) {
  console.log('已经打过补丁（内容与版本串都在），无需重复执行。')
  process.exit(0)
}
if (lab.includes('aiImgs') !== htmlVersioned) {
  fail('补丁状态不一致：可能上次执行中断。请从备份恢复 site/ 后重跑。')
}
if (!lab.includes('__name:"PromptBuilder"')) fail('LabPlayView 里找不到 PromptBuilder 组件')

// ── 补丁内容 ────────────────────────────────────────────────
const patches = [
  [
    '候选图状态 aiImgs',
    'P=E(0),F=[',
    'P=E(0),aiImgs=E([]),F=[',
  ],
  [
    '生成函数改为真实请求',
    'function k(){if(!f.value||!b.value){ce.warning("至少要填写「主体」和「场景」，AI 才知道画什么");return}u.value=!0,oe.value=0;const s=setInterval(()=>{oe.value+=1,oe.value>=F.length&&(clearInterval(s),u.value=!1,re.value=!0,P.value=0,ie.markLab("prompt-builder",G.value),ce.success(`生成了 4 张候选画面 · 提示词评分 ${G.value} 分`))},380)}',
    'async function k(){if(!f.value||!b.value){ce.warning("至少要填写「主体」和「场景」，AI 才知道画什么");return}u.value=!0,oe.value=0,aiImgs.value=[];const aiT=setInterval(()=>{oe.value<2&&(oe.value+=1)},800);try{const aiP=`主体：${f.value}。`+(b.value?`场景：${b.value}。`:"")+(h.value?`动作：${h.value}。`:"")+(w.value?`风格：${w.value}。`:"")+(A.value?`镜头：${A.value}。`:"")+(V.value.length?`要求：${V.value.join("，")}。`:""),aiR=await fetch("/api/ai/image",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:aiP,n:4})}),aiJ=await aiR.json().catch(()=>({}));if(!aiR.ok)throw new Error(aiJ&&aiJ.error&&aiJ.error.message||"生成失败，请稍后再试");if(!aiJ.images||!aiJ.images.length)throw new Error("没有拿到画面，请稍后再试");clearInterval(aiT),oe.value=Math.max(oe.value,2),await new Promise(aiW=>setTimeout(aiW,400)),oe.value=3,await new Promise(aiW=>setTimeout(aiW,600)),aiImgs.value=aiJ.images,re.value=!0,P.value=0,ie.markLab("prompt-builder",G.value),ce.success(`生成了 ${aiJ.images.length} 张候选画面 · 提示词评分 ${G.value} 分`)}catch(aiE){ce.error(aiE&&aiE.message||"生成失败，请稍后再试")}finally{clearInterval(aiT),u.value=!1}}',
  ],
  [
    '候选图渲染真实图片',
    'r(Je,{subject:f.value,scene:b.value,action:h.value,style:J(w.value),lens:A.value,limits:V.value,seed:Q-1},null,8,["subject","scene","action","style","lens","limits","seed"])',
    'aiImgs.value[Q-1]?e("img",{src:aiImgs.value[Q-1],class:"h-full w-full object-cover",alt:"候选画面 "+Q},null,8,["src"]):r(Je,{subject:f.value,scene:b.value,action:h.value,style:J(w.value),lens:A.value,limits:V.value,seed:Q-1},null,8,["subject","scene","action","style","lens","limits","seed"])',
  ],
  [
    '大图预览真实图片',
    're.value?(t(),ue(Je,{key:1,subject:f.value,scene:b.value,action:h.value,style:J(w.value),lens:A.value,limits:V.value,seed:P.value},null,8,["subject","scene","action","style","lens","limits","seed"]))',
    're.value?(t(),aiImgs.value[P.value]?l("img",{key:1,src:aiImgs.value[P.value],class:"h-full w-full object-cover",alt:"候选画面 "+(P.value+1)},null,8,["src","alt"]):ue(Je,{key:1,subject:f.value,scene:b.value,action:h.value,style:J(w.value),lens:A.value,limits:V.value,seed:P.value},null,8,["subject","scene","action","style","lens","limits","seed"]))',
  ],
  [
    '候选缩略图从 58px 高改为正方形',
    '_c={class:"h-[58px]",style:{background:"#0b1220"}}',
    '_c={class:"aspect-square overflow-hidden",style:{background:"#0b1220"}}',
  ],
  [
    '假图说明文案',
    '"模拟生成画面（非真实 AI 出图）"',
    '"AI 真实出图 · 一次 4 张，请稍候"',
  ],
  [
    '假候选评语改为中性标签',
    'H=["构图最完整，推荐","视角度不同","主体更突出","氛围感更强"]',
    'H=["候选 1","候选 2","候选 3","候选 4"]',
  ],
]

for (const [label, from, to] of patches) {
  const n = lab.split(from).length - 1
  if (n !== 1) fail(`锚点「${label}」命中 ${n} 次（应为 1）。前端构建可能已变，需同步移植补丁。`)
  lab = lab.split(from).join(to)
}

// ── 备份原文件 ──────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupDir = join(root, `site-prompt-builder-backup-${stamp}`)
mkdirSync(backupDir, { recursive: true })
for (const f of [entryName, labName]) copyFileSync(join(assets, f), join(backupDir, f))
copyFileSync(htmlPath, join(backupDir, 'index.html'))

// ── 版本串：内容哈希，同内容重跑不会产生新 URL ──────────────
const ver = hash8(lab)

// 给所有 chunk 里的相对 .js 引用统一加 ?v=ver（含已存在旧版本串的重写）
let rewrittenFiles = 0
let rewrittenRefs = 0
for (const f of readdirSync(assets)) {
  if (!f.endsWith('.js')) continue
  const p = join(assets, f)
  const src = readFileSync(p, 'utf8')
  const out = src.replace(/"(\.\/[^"]+?\.js)(?:\?v=[^"]*)?"/g, (_, spec) => {
    rewrittenRefs++
    return `"${spec}?v=${ver}"`
  })
  if (out !== src) {
    writeFileSync(p, out)
    rewrittenFiles++
  }
}

// 组件内容落在原文件名上（查询串负责让浏览器重新取）。
// 注意 lab 是从磁盘读入的旧内容，全局重写循环处理的是磁盘上的未打补丁版本，
// 所以这里必须对补丁后的字符串再补一次版本串，否则它的 "./index-xxx.js"
// 会退回无版本 URL，又变成两份入口模块。
lab = lab.replace(/"(\.\/[^"]+?\.js)(?:\?v=[^"]*)?"/g, (_, spec) => `"${spec}?v=${ver}"`)
writeFileSync(labPath, lab)

// index.html 的入口引用带同一个版本串
const newHtml = html.replace(
  new RegExp(`assets/${entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[\\w-]+)?`),
  `assets/${entryName}?v=${ver}`,
)
if (newHtml === html) fail('index.html 入口引用替换失败')
writeFileSync(htmlPath, newHtml)

try {
  for (const f of readdirSync(assets)) {
    if (f.endsWith('.js')) chownSync(join(assets, f), 33, 33) // www-data
  }
  chownSync(htmlPath, 33, 33)
} catch {
  console.warn('⚠️  chown www-data 失败（不是 root？），文件权限可能不对')
}

console.log(`✅ 补丁完成
   组件: ${labName}（已替换为真实出图实现）
   入口: ${entryName}
   版本: ?v=${ver}
   重写: ${rewrittenFiles} 个 chunk，${rewrittenRefs} 处引用
   备份: ${backupDir}`)
