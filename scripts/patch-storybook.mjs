#!/usr/bin/env node
/**
 * 给「故事绘本」的**构建产物**打「真实 AI 插画」补丁。
 *
 * 和 patch-prompt-builder.mjs 同一套路：前端源码不在服务器上（见 HANDOFF §5/§6），
 * 服务器只有 Vite 构建产物。此脚本在 site/assets 的 LabPlayView chunk 里定位
 * Storybook 组件：
 *   · 把本地假的 `te()`（只弹成功提示、画内联 SVG）换成调用 /api/ai/storybook；
 *   · 按页生成提示词，每 4 页一批，结果按页序对位；
 *   · 页面卡片里已有真实插画就渲染 <img>，缺图（或还没生成）仍显示原来的
 *     SVG 占位图，不会白屏；
 *   · 生成期间按钮转圈、显示「正在绘制 N / M 页」，并加生成令牌，
 *     切诗/加页/删页时旧请求结果直接丢弃，避免插图错页。
 *
 * 缓存失效同样用查询串而不是改文件名，原因见 patch-prompt-builder.mjs 顶部注释。
 *
 * 重新构建前端后需按顺序重跑：
 *   sudo node scripts/patch-prompt-builder.mjs
 *   sudo node scripts/patch-storybook.mjs
 *   sudo node scripts/patch-lazy-images.mjs
 *
 * 用法（需要写 site/ 的权限）：
 *   sudo node scripts/patch-storybook.mjs
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

// 站点可能已经被其他补丁带上 ?v= 版本串，所以只按绘本补丁标记判断幂等
if (lab.includes('sbImgs')) {
  console.log('已经打过补丁（Storybook 真实插画），无需重复执行。')
  process.exit(0)
}
if (!lab.includes('__name:"Storybook"')) fail('LabPlayView 里找不到 Storybook 组件')

// ── 补丁内容 ────────────────────────────────────────────────
const patches = [
  [
    '插画状态与生成令牌',
    'A=E(!1),V=R(',
    'A=E(!1),sbImgs=E([]),sbLoading=E(!1),sbProgress=E(0),sbSeq=E(0),V=R(',
  ],
  [
    '生成函数改为真实请求',
    'function te(){if(!h.value.every(re=>re.who&&re.where&&re.doing)){ce.warning("每一页至少要有「谁 / 在哪 / 做什么」，AI 才知道要画什么");return}A.value=!0;const u=Math.min(100,Math.round(h.value.reduce((re,oe)=>re+Object.values(oe).filter(Boolean).length*4,0)/h.value.length));ie.markLab("storybook",u),ce.success("绘本生成成功！")}',
    'async function te(){if(!h.value.every(re=>re.who&&re.where&&re.doing)){ce.warning("每一页至少要有「谁 / 在哪 / 做什么」，AI 才知道要画什么");return}const sbS=++sbSeq.value;A.value=!1,sbImgs.value=[],sbLoading.value=!0,sbProgress.value=0;try{const sbP=h.value.map((re,oe)=>"儿童绘本插画（水彩童书风格，构图简洁、色彩明亮），第"+(oe+1)+"页："+re.who+"在"+re.where+"，"+re.doing+(re.color?"，以"+re.color+"为主色调":"")+(re.mood?"，画面氛围"+re.mood:"")+"。故事《"+V.value.name+"》。画面中不要出现文字。"),sbAll=[];for(let sbI=0;sbI<sbP.length;sbI+=4){const sbC=sbP.slice(sbI,sbI+4),sbR=await fetch("/api/ai/storybook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompts:sbC})});if(sbS!==sbSeq.value)return;const sbJ=await sbR.json().catch(()=>({}));if(!sbR.ok)throw new Error(sbJ&&sbJ.error&&sbJ.error.message||"绘本生成失败，请稍后再试");if(!sbJ.images||!sbJ.images.length)throw new Error("没有拿到插画，请稍后再试");sbAll.push(...sbJ.images),sbImgs.value=sbAll.slice(),sbProgress.value=sbAll.filter(Boolean).length}if(sbS!==sbSeq.value)return;A.value=!0;const u=Math.min(100,Math.round(h.value.reduce((re,oe)=>re+Object.values(oe).filter(Boolean).length*4,0)/h.value.length));ie.markLab("storybook",u),ce.success("绘本生成成功！")}catch(sbE){sbS===sbSeq.value&&ce.error(sbE&&sbE.message||"绘本生成失败，请稍后再试")}finally{sbS===sbSeq.value&&(sbLoading.value=!1)}}',
  ],
  [
    // 动态 props 必须带组件的 patchFlag(8)+dynProps，否则父组件重渲染时
    // Vue 会把这个组件当静态节点跳过，按钮永远不转圈也不禁用。
    '生成按钮转圈并禁用',
    'r(F,{type:"primary",round:"",class:"w-full",onClick:te},{default:y(()=>[r(ae,{class:"mr-1"},{default:y(()=>[r(H)]),_:1}),u[13]||(u[13]=v("生成我的绘本 ",-1))]),_:1})',
    'r(F,{type:"primary",round:"",class:"w-full",loading:sbLoading.value,disabled:sbLoading.value,onClick:te},{default:y(()=>[r(ae,{class:"mr-1"},{default:y(()=>[r(H)]),_:1}),u[13]||(u[13]=v("生成我的绘本 ",-1))]),_:1},8,["loading","disabled"])',
  ],
  [
    '生成期间禁止加页',
    'r(F,{size:"small",round:"",onClick:le},{default:y(()=>[...u[11]||(u[11]=[v("+ 加一页",-1)])]),_:1})',
    'r(F,{size:"small",round:"",disabled:sbLoading.value,onClick:le},{default:y(()=>[...u[11]||(u[11]=[v("+ 加一页",-1)])]),_:1},8,["disabled"])',
  ],
  [
    '生成期间禁止删页',
    'r(F,{size:"small",round:"",plain:"",onClick:ee},{default:y(()=>[...u[12]||(u[12]=[v("删除本页",-1)])]),_:1})',
    'r(F,{size:"small",round:"",plain:"",disabled:sbLoading.value,onClick:ee},{default:y(()=>[...u[12]||(u[12]=[v("删除本页",-1)])]),_:1},8,["disabled"])',
  ],
  [
    '加载进度条（页面卡片上方）',
    'e("div",null,[e("div",pd,[',
    'e("div",null,[sbLoading.value?(t(),l("div",{key:"sb-loading",class:"mb-3 rounded-xl2 p-3 text-center text-[13px] font-semibold",style:{background:"rgba(53,89,246,.08)",border:"1px solid rgba(53,89,246,.25)",color:"var(--aiq-accent)"}},"AI 正在绘制绘本 "+o(sbProgress.value)+" / "+o(h.value.length)+" 页，请稍候…",1)):W("",!0),e("div",pd,[',
  ],
  [
    '页面卡片渲染真实插画',
    '[(t(),l("svg",yd,',
    '[sbImgs.value[C]?e("img",{src:sbImgs.value[C],class:"w-full object-cover",style:{aspectRatio:"3 / 2"},alt:"第"+(C+1)+"页插画"},null,8,["src","alt"]):(t(),l("svg",yd,',
  ],
  [
    '换诗时清空插画并作废旧请求',
    'function ne(z){b.value=z,h.value=[{who:"",where:"",doing:"",color:"",mood:""}],w.value=0,A.value=!1}',
    'function ne(z){b.value=z,h.value=[{who:"",where:"",doing:"",color:"",mood:""}],w.value=0,A.value=!1,sbImgs.value=[],sbProgress.value=0,sbSeq.value++,sbLoading.value=!1}',
  ],
  [
    '加页时作废旧请求（已生成的插画保留，页序只追加）',
    'function le(){h.value.push({who:"",where:"",doing:"",color:"",mood:""}),w.value=h.value.length-1,A.value=!1}',
    'function le(){h.value.push({who:"",where:"",doing:"",color:"",mood:""}),w.value=h.value.length-1,A.value=!1,sbSeq.value++,sbLoading.value=!1}',
  ],
  [
    '删页会打乱页序，清空插画并作废旧请求',
    'function ee(){h.value.length<=1||(h.value.splice(w.value,1),w.value=Math.max(0,w.value-1))}',
    'function ee(){h.value.length<=1||(h.value.splice(w.value,1),w.value=Math.max(0,w.value-1),A.value=!1,sbImgs.value=[],sbProgress.value=0,sbSeq.value++,sbLoading.value=!1)}',
  ],
]

for (const [label, from, to] of patches) {
  const n = lab.split(from).length - 1
  if (n !== 1) fail(`锚点「${label}」命中 ${n} 次（应为 1）。前端构建可能已变，需同步移植补丁。`)
  lab = lab.split(from).join(to)
}

if (process.env.DRY) {
  writeFileSync('/tmp/storybook-lab-dry.mjs', lab)
  console.log('DRY：锚点全部命中，已写出 /tmp/storybook-lab-dry.mjs 供语法检查（未改动 site/）。')
  process.exit(0)
}

// ── 备份原文件 ──────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupDir = join(root, `site-storybook-backup-${stamp}`)
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
// 磁盘上的旧内容已被上面的循环重写，这里必须对补丁后的字符串再补一次版本串。
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

console.log(`✅ 绘本补丁完成
   组件: ${labName}（Storybook 已接入 /api/ai/storybook）
   入口: ${entryName}
   版本: ?v=${ver}
   重写: ${rewrittenFiles} 个 chunk，${rewrittenRefs} 处引用
   备份: ${backupDir}`)
