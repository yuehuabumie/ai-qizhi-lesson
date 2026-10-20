# 交接文档（给 GPT）：班级作业 / 主导航 / 横屏与响应式审查

## 2026-10-20 本轮接续说明（已部署并完成生产复核）

本轮范围已扩展为用户要求的全站前端设计、手机适配和本交接未完成项。详细范围、复跑命令与最终证据见 [UI-ACCEPTANCE-2026-10-20.md](./docs/UI-ACCEPTANCE-2026-10-20.md)；当前快照结构和运行方式见更新后的 [README.md](./README.md)。

静态更新已于 **2026-10-20 18:27:23（Asia/Shanghai）** 部署。最终结果：API **45/45**；扩展 UI（预览）**43/43**（含真实插画生成 → 审查 → 提交 → 教师展厅发布/撤下）；生产全站五视口、浅色/深色 **544/544**（506 个布局/主题测量结果 + 38 个交互断言）；生产 320px / 375px 窄屏 **56/56**；动态细节（预览）**99/99**；Node **4/4**、TypeScript 检查通过。全站覆盖 27 个主路由，包含全部 13 个训练入口，另含登录/注册和班级/作业动态状态；**544 是检查结果数，不是不同页面数**。此前 535/535 是新增 9 个触控断言前的预览结果，不作为生产通过数。12 个互动练习只完成 `markLab` 回调标识的静态一致性检查，不能写成全部人工通关。

百人名单、长姓名/标题、六视口作品详情/弹窗、断网和提交失败重试、弹窗竞态与学生确认焦点管理已纳入 99/99 预览细节验收。生产三模块为 `class-studio.js?v=zocjnIv2`、`storybook-studio.js?v=g4FAWhz7`、`responsive-shell.js?v=5EGv9JH6`，源文件与线上副本已核实一致；SHA-256 见 [module-hashes.json](./docs/ui-20261020/module-hashes.json)。永久证据归档位置为 `/home/ubuntu/aiq-api/validation/ui-20261020/evidence.zip` 与 `summary.json`，仓库摘要为 [docs/ui-20261020/summary.json](./docs/ui-20261020/summary.json)。iOS Safari / Android 真机、真实软键盘、安全区和地址栏变化仍未实机验证，其他未验收范围见验收记录。

下文保留接续前的历史清单与原因说明；未勾选项和“未验证”等表述描述交接时状态，不能据此覆盖本轮已取得结果。旧脚本退出码、主题检查等问题是否已修，以当前代码及验收记录为准。纯静态模块变更无需重启 API。

---

- 日期：2026-10-20
- 仓库：`/home/ubuntu/aiq-api`（不是 git 仓库，改动直接落在文件上）
- 线上站点：`/var/www/yuehua.online` → 软链到 `/home/ubuntu/aiq-api/site`
- 后端：Fastify + TypeScript，`aiq-api.service`，127.0.0.1:3020，数据库 `aiq_course`
- 本次交接范围：三类班级作业（AI 绘本 / 互动练习 / 课程任务）、班级管理主导航标签、横屏与响应式审查修复
- **先读**：`HANDOFF.md` §2「红线」、`README.md`；文档声明的产品意图是审查基准，不要把有意设计当成缺陷

---

## 0. 一句话现状

功能已经完整实现并部署，前端模块已安装；但**最终 CSS 修复后的完整回归没有跑完**，学生端响应式只验证了 1366/1024 的一部分，横屏 844×390 和竖屏 390×844 的学生页面尚未在当前构建上验证，文档也未更新。下面把所有未完成项和简化项逐条列清楚。

当前线上资源版本（`site/index.html`）：

- `assets/storybook-studio.js?v=y0eRye10`
- `assets/class-studio.js?v=XFzkbrk1`

`npm run typecheck` 已通过；后端代码本次未改，**不需要重启 `aiq-api.service`**；本次未改 nginx、未改数据库。

---

## 1. 没做完的（按优先级）

### P0 — 必须在最终构建上重跑的回归

- [ ] **1.1 重跑班级作业 UI 验收（32 项）**
  - 脚本：`scripts/assign-ui-e2e.mjs`
  - 上次结果：**32/32 通过**，但那次运行早于以下改动：根节点 `cls-page → cls-studio-root`、`box-sizing:border-box`、监考条尺寸/安全区修复。
  - 必须重跑，重点确认：班级详情页布局、三类作业创建、学生监考条、提交后回显、绘本创作台入口。
  - 命令：
    ```bash
    cd /home/ubuntu/aiq-api
    E2E_BASE=https://yuehua.online \
    E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
      node scripts/assign-ui-e2e.mjs
    ```

- [ ] **1.2 重跑班级作业 API 验收（45 项）**
  - 脚本：`scripts/assign-e2e.mjs`
  - 上次结果：**45/45 通过**。后端本次未改，优先级低于 1.1，但建议在交付前一并复跑。
  - 命令：`node scripts/assign-e2e.mjs`（需要 sudo 读 Redis/MySQL 反推验证码；会真的发一封验证码邮件）

- [ ] **1.3 重跑完整响应式审计（教师端 5 个视口）**
  - 脚本：`scripts/responsive-audit.mjs`（已从 /tmp 复制入仓，import 已改为相对路径）
  - 上次完整教师端结果是在 `box-sizing` 修复**之前**：
    - 1366/1024/844×390/768/390 均无页面级横向溢出、无固定元素遮挡、表格不溢出、弹窗在视口内
    - 390 下班级详情页出现 Chrome 移动端自动缩小（`innerWidth` 从 390 变成 413），隐藏了约 23px 的真实横向溢出
  - 根因已修：模块从未设置 `box-sizing`，旧根节点 `cls-page` 恰巧带 `overflow:hidden` 把溢出裁掉了；重命名根节点后问题才暴露。已在 `scripts/class-studio.js:1845` 增加作用域内的 `box-sizing:border-box`。
  - 修复后只做了 **390 单页探针**（`scripts/overflow-probe.mjs`，结果 `docW=390`、无越界元素）；1366/1024/844/768 尚未在最终构建上复跑。
  - 命令（必须先等限流冷却，见 §6）：
    ```bash
    AUDIT_WHOLE_SITE=1 E2E_BASE=https://yuehua.online \
    E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
      node scripts/responsive-audit.mjs > /tmp/responsive-audit4.log 2>&1
    ```

- [ ] **1.4 学生端响应式审计（当前构建上基本没做）**
  - `scripts/responsive-audit.mjs` 的学生端流程：1366 完整跑过；1024 跑到绘本作业时被 429 限流中断；**844×390（横屏手机）/ 768×1024 / 390×844 从未在最终构建上跑过**。
  - 中断原因（已确认，不是产品 bug）：`/api/assign/:token/verify` 的 IP 限流是 **30 次 / 10 分钟**（`src/routes/classes.ts:1201`），两轮审计连续跑了 30 次验证，第 31 次返回 429；脚本没有检查 verify 的 HTTP 状态，继续去等创作台，最终超时。
  - 需验证：学生入口页、互动练习工作台、监考条（位置/尺寸/安全区/44px 按钮）、课程任务工作台、绘本创作台在 **844×390 横屏**和 **390×844 竖屏**的表现。

### P1 — 明确的覆盖缺口

- [ ] **2.1 横屏 844×390 的移动端导航抽屉未验证**
  - 断点在 1024 以下使用汉堡菜单；主导航标签已验证 1024–1440 桌面布局和 390×844 抽屉，但 **844×390（横屏手机）的抽屉开关、行高 44px、关闭行为、滚动**没有在当前构建上验证。

- [ ] **2.2 暗色模式完全没审查**
  - 站点有明暗主题切换，本次只在浅色主题下做了响应式审计。`class-studio` 使用 `--aiq-*` 变量并有兜底色，但暗色下的对比度、边框、监考条背景均未验证。

- [ ] **2.3 README / HANDOFF 未更新**
  - 需要补充：三类作业（绘本 / 互动练习 / 课程任务 + 配套工具台）、班级管理主导航标签、学生监考条、安装脚本顺序、新增的路由与教师/学生页面。
  - `HANDOFF.md` §3 待办和 §4 已知问题也应同步。

- [ ] **2.4 任务状态未整理**
  - 内部任务 #35/#36/#42/#43/#44 状态落后于实际进度（部分功能已由 32/32 UI 验收证实）。交付前更新，避免误导。

- [ ] **2.5 其他 11 个互动练习的 `markLab` 回调没有逐个验证**
  - 学生监考条依赖各训练页调用 `app.markLab(labId, score)`。本次 UI 验收只用了 `ai-senses`（AI 的五官配对）。
  - 需要用 12 个 lab 的清单逐个确认：完成训练时是否都会触发 `markLab`，labId 是否与作业配置一致。

- [ ] **2.6 绘本作业的完整 UI 生成流程未走通**
  - UI 验收只确认了学生能进入创作台、看到「AI 生成剩余次数」和「审查提交」步骤。
  - 没有在浏览器里完整走「生成插画 → 审查 → 提交」。API 层的绘本提交已测（45 项里覆盖）。

- [ ] **2.7 班级提交作品「发布到展厅」的 UI 未测**
  - 后端发布能力已实现；本次班级作业 UI 验收没有覆盖教师把学生作品发布到展厅的界面路径。

- [ ] **2.8 错误态 UI 未系统验证**
  - 作业链接失效/关闭、名单已满、重名、照片上传失败、验证码错误等错误提示，后端有测试，但前端提示与禁用态没有逐项在浏览器里验证。

### P2 — 质量项

- [ ] **3.1 桌面端视觉回归**
  - `box-sizing:border-box` 是对整个模块的全局尺寸变化（按钮、输入框、卡片内边距都从 content-box 改为 border-box）。390 已确认修复，但 1366/1024/844/768 的按钮/输入框/筛选器视觉需要看截图确认，不能只看数值。

- [ ] **3.2 键盘可访问性 / 对比度 / 焦点管理**
  - 未做键盘遍历、屏幕阅读器、对比度测量；自定义弹窗缺少焦点陷阱与关闭后焦点归还（详见 §2.4）。

- [ ] **3.3 真机测试**
  - 目前全部是 Chromium CDP 模拟，没有 iOS Safari / Android Chrome 真机；软键盘弹出遮挡、真实 `safe-area-inset-bottom`、横竖屏切换都没有验证。

- [ ] **3.4 审计脚本入库与工具修复**
  - `scripts/responsive-audit.mjs`、`scripts/overflow-probe.mjs` 已从 /tmp 复制入仓，但仍是临时工具，没有修复下面两个问题：
  - 脚本有两个必须修的问题：
    1. **审计失败仍返回退出码 0**。`/tmp/responsive-audit2.log` 末尾明明有「审计失败」，后台任务却报告成功。外层 catch 没有设置 `process.exitCode = 1`。
    2. **移动端自动缩放会掩盖横向溢出**。脚本用 `innerWidth` 作为基准，Chrome 移动模拟在内容超宽时会自动把 `innerWidth` 放大（390→413），于是 `docW > vw` 永远不成立。应改为与请求的视口宽度（或 `screen.width`）比较，并读取 `visualViewport.scale`。
  - 另外：每个视口应使用**不同学生姓名**或每个视口新建班级，避免重复使用同一学生触发提交/限流状态；每次 verify 后检查响应状态，429 时明确失败而不是继续等待。

---

## 2. 简化 / 取巧 / 没做透的地方（逐条）

### 2.1 主导航标签是运行时 DOM 注入，不是前端源码集成
- 位置：`scripts/class-studio.js:1657` 起（图标、`injectDesktopNav`、`injectDrawerNav`、`installNavTab`、active 同步）。
- 做法：等 Vue 挂载后，在桌面 `header nav` 的 `a[href="#/teach"]` 后插入一个 `<a class="nav-item">`；移动端在 `.el-drawer__body` 的「课堂教学」后插入一行；用 `hashchange` + `MutationObserver` 同步 `is-active` / `aria-current="page"`。
- 风险：前端重新构建后如果头部结构、类名或「课堂教学」链接变化，注入会失效或插错位置；没有编译期保障。
- 没有做的事：没有修改前端源码/路由源文件（服务器上没有前端源码），也没有为注入失败提供可见告警，只在 `console.warn` 里记录。

### 2.2 头部毛玻璃是伪元素 hack
- 位置：`scripts/class-studio.js:2116-2120`。
- 原因：Element Plus 抽屉渲染在 `<header>` 内部，`header` 上的 `backdrop-filter` 会成为 `position:fixed` 后代的包含块，把抽屉压成 74px 高。
- 做法：把 `header.aiq-navbar` 的 `backdrop-filter` 强制设为 `none`，把模糊移到 `header::after`（`position:absolute; inset:0; z-index:-1`）。
- 风险：依赖站点头部类名 `aiq-navbar`；如果站点自己改头部模糊/层级，需要重新验证。

### 2.3 移动抽屉关闭依赖合成 Escape 事件
- 位置：`scripts/class-studio.js:1688` 起。
- 做法：优先点 `.el-drawer__close-btn`，找不到时在 `document` 上派发 `KeyboardEvent('keydown', {key:'Escape'})`。
- 风险：这是对 Element Plus 内部行为的依赖；升级 Element Plus 后可能失效。当前构建实测可关闭，但没有长期保障。

### 2.4 自定义弹窗的无障碍只做了一半
- 位置：`scripts/class-studio.js:900` 起。
- 已有：`role="dialog"`、`aria-modal="true"`、Escape 关闭、打开后聚焦第一个 `input/textarea/button`、点击遮罩关闭。
- 缺失：
  - 没有 `aria-labelledby` / `aria-label`，弹窗没有可访问名称；
  - 没有焦点陷阱（Tab 可以跑到弹窗外）；
  - 关闭后不把焦点还给触发按钮；
  - 背景没有 `aria-hidden` / inert。
- 如果要达到正常无障碍标准，这几项都要补。

### 2.5 触控目标只修了「硬伤」，没有全面达到 44px
- 已修：监考条两个按钮 44px（`scripts/storybook-studio.js:3165`）、抽屉行 44px、`.cls-back` 从 20px 提到 32px。
- 现状：
  - WCAG 2.2 AA 的 24px 最低线基本满足；审计里唯一的 `<24px` 是作业详情页正文里的内联链接「AI 的五官配对」（90.9×16），属于 WCAG 2.5.8 的 inline 例外，可以不改。
  - 但大量控件仍在 32–42px（表格图标按钮 32×32、按钮 40px、输入框 42px、下拉 38px 等）。如果验收标准是「所有触控目标 ≥44」，这还没达标。
  - 学生绘本创作台控件数量多：1366 下有 49 个控件小于 44px（其中大多数是既有创作台控件）。本次没有动创作台的触控尺寸。

### 2.6 只用 Chromium 模拟，未做真机
- 视口：1366×768、1024×768、844×390（横屏手机）、768×1024、390×844。
- 未覆盖：软键盘遮挡表单、`safe-area-inset-*` 真机值、横竖屏切换后的布局重算、移动浏览器地址栏收缩/展开导致的 `vh` 变化、触控滚动惯性、iOS 输入框自动缩放（<16px 字号）。
- 监考条虽然写了 `env(safe-area-inset-bottom, 0px)` 和 136px 移动端底部留白，但只在模拟器里量过，没在真机上确认。

### 2.7 表格在窄屏是转换布局，不是完整响应式表格
- `.cls-table-scroll` 提供横向滚动兜底；≤620px 时表格改为 block 卡片式（`thead` 隐藏，`td::before` 显示 `data-label`）。
- 没测过：超长姓名、100 人满员名单、长作业标题、长链接、窄屏下操作列换行；没有分页/虚拟列表，全部一次性渲染（名单最多 100，当前可以接受，但没做压力测试）。

### 2.8 监考条只采样了两个桌面视口
- 已验证（监考条 CSS 就是当前最终版，storybook 模块此后未再改）：1366 和 1024 下 `760×66`、right 在视口内、按钮 44px、`body` 底部留白 96px。
- **没验证**：844×390、768×1024、390×844 下监考条是否换行、是否超出视口、136px 移动端底部留白是否足够、内容是否被遮挡。

### 2.9 响应式审计脚本本身是临时工具
- 未入库、未纳入 CI；失败退出码错误；移动端自动缩放会掩盖溢出；复用了同一批学生姓名；没有把 HTTP 429/401 当失败。
- 这意味着「审计通过」的结论只能作为参考，不能作为长期门禁。

### 2.10 测试数据与限流耦合
- UI/API 验收和审计都使用 `301@301.group`，但昵称不同（作业冒烟测试 / 作业界面验收 / 响应式验收）。`cleanupUser` 只在昵称匹配时删除账号。
- 如果某次运行在清理前失败，下次用同一邮箱注册会遇到 409；需要人工用正确昵称清理，或按脚本约定使用 `SMOKE_FORCE=1`（仅限确认无他人数据时）。
- 限流：作业 verify 30 次/10 分钟/IP（同 token 300 次/小时）；注册发码 1 次/分钟/邮箱。连续跑两个浏览器验收必须间隔等待，否则会误判为产品故障。

### 2.11 其他刻意简化的点
- 没有新增分页、搜索服务端化、批量操作、导出；班级上限 100 人、作业列表一次性加载。
- 没有图片压缩/WebP 转换（这是项目明确约束，不是遗漏）。
- 没有做骨架屏/CLS 指标；加载态只有按钮 busy 文案。
- 没有做自动化视觉回归（截图只做了人工查看）。
- 没有验证切到后台标签页、网络断开、接口超时后的恢复行为。

---

## 3. 已完成并验证过的（不要重复做）

### 3.1 三类班级作业
- 教师端：创建班级、导入/重命名/删除名单、三类作业创建（AI 绘本 / 互动练习 / 课程任务 + 可选配套工具台）、作业详情、提交列表、查看提交弹窗、删除班级。
- 学生端：仅凭姓名核对名单进入；互动练习监考条捕获成绩、提交、刷新后深链恢复；课程任务文字 + 照片提交与回显；绘本作业进入创作台并带班级作业面包屑。
- 后端：三类作业创建、学生提交、教师查看、发布作品等接口；班级详情故意不返回 token，单个作业详情才返回 token（`src/routes/classes.ts:428-487` vs `648-743`）。

### 3.2 主导航标签
- 桌面 1024–1440：标签出现在「课堂教学」后，激活态 `is-active` + `aria-current="page"`，无横向溢出。
- 移动 390×844：抽屉内新增一行，44px 高，点击导航并关闭抽屉。

### 3.3 本次已修的布局问题
- 根节点类名冲突：`cls-page` 与绘本预览卡的 `.cls-page{display:grid;grid-template-columns:...}` 冲突，导致教师页只有约 518px 宽；已改为 `cls-studio-root`（`scripts/class-studio.js:1608`、1833 起）。
- 模块缺少 `box-sizing`：390px 下输入框/文本域按 content-box 计算，撑出容器，Chrome 自动缩小页面掩盖溢出；已在 `scripts/class-studio.js:1845` 加作用域规则，并给 ≤900px 的详情网格加 `minmax(0,1fr)` + `min-width:0`。
- 监考条：`box-sizing:border-box`、`width:min(760px, calc(100% - 24px))`、底部安全区、移动端底部留白 136px、按钮 44px（`scripts/storybook-studio.js:3157-3168, 3220-3221`）。
- `.cls-back` 最小高度 32px；抽屉行 `box-sizing:border-box` + `min-height:44px`。

### 3.4 验收证据
- `scripts/assign-ui-e2e.mjs`：32/32 通过（旧构建，需复跑）。
- `scripts/assign-e2e.mjs`：45/45 通过（后端未改）。
- 教师端响应式审计 5 视口（旧构建，`/tmp/responsive-audit2.log`）：无页面横向溢出、无固定元素遮挡、表格不溢出、弹窗均在视口内。
- 390 修复后单页探针：`docW=390`、无越界元素、两张卡片 342px 宽。
- 监考条桌面：1366/1024 下 760×66，按钮 44px，底部留白 96px。

---

## 4. 关键文件与改动点

| 文件 | 作用 / 本次改动 |
|---|---|
| `scripts/class-studio.js` | 班级管理、作业创建/详情、学生入口、主导航注入；根节点改名、box-sizing、移动网格、弹窗、导航 CSS |
| `scripts/storybook-studio.js` | 绘本创作台 + 学生作业模式 + 监考条；监考条尺寸/安全区/44px 按钮 |
| `scripts/assign-ui-e2e.mjs` | 三类作业浏览器验收（32 项）；token 改为逐作业详情获取，提交后断言改为 `.sbk-submitted` / `.sbk-assign-scorebox` / `.sbk-task-photos.is-readonly` |
| `scripts/assign-e2e.mjs` | 三类作业 API 验收（45 项） |
| `scripts/install-class-studio.mjs` | 安装 `class-studio.js` 到 `site/assets` 并更新 `index.html` 版本串 |
| `scripts/install-storybook-studio.mjs` | 同上（绘本模块） |
| `scripts/lib/cdp-kit.mjs` | CDP 浏览器工具；`setViewport`、`E2E_BROWSER_FLAGS_JSON` |
| `scripts/lib/kit.mjs` | 注册/清理/断言工具；`cleanupUser` 昵称护栏 |
| `site/index.html` / `site/assets/*.js` | 线上实际资源（`/var/www/yuehua.online` 软链到这里） |

关键行号（当前文件）：

- 根节点：`scripts/class-studio.js:1608`
- 弹窗：`scripts/class-studio.js:900`
- 导航注入：`scripts/class-studio.js:1657-1745`
- box-sizing：`scripts/class-studio.js:1845`
- `.cls-back`：`scripts/class-studio.js:1855`
- 详情网格：`scripts/class-studio.js:1918`；≤900 修复：`2073-2079`；≤620 表格/表单：`2080-2106`
- 头部模糊 workaround：`scripts/class-studio.js:2116-2120`
- 监考条 CSS：`scripts/storybook-studio.js:3157-3168`；移动端：`3220-3221`
- 监考条 markup：`scripts/storybook-studio.js:595-605`

---

## 5. 安装与部署

前端模块是独立脚本，安装后立即生效（静态文件，不需要 reload nginx，也不需要重启后端）：

仅修改某个运行时模块时，备份后执行它对应的安装脚本即可。若从原完整 Vue 源码
重新构建了前端，需在新产物就位、用户上传目录保留后按以下完整顺序恢复补丁与模块：

```bash
cd /home/ubuntu/aiq-api
sudo node scripts/patch-prompt-builder.mjs
sudo node scripts/patch-storybook.mjs
sudo node scripts/patch-lazy-images.mjs
sudo node scripts/install-storybook-studio.mjs
sudo node scripts/install-gallery-studio.mjs
sudo node scripts/install-me-studio.mjs
sudo node scripts/install-class-studio.mjs
sudo node scripts/install-responsive-shell.mjs
grep -o 'class-studio.js?v=[A-Za-z0-9_-]*\|storybook-studio.js?v=[A-Za-z0-9_-]*\|responsive-shell.js?v=[A-Za-z0-9_-]*' site/index.html
```

浏览器验收必须保留站点主机名 `https://yuehua.online`，本机访问用上文的 Chromium
host resolver 参数映射到 `127.0.0.1`；直接以 IP 作为 HTTPS URL 可能命中其他站点。
普通个人作品署名仍取账号昵称；教师发布本人班级的学生提交时可选择展厅署名，是明确的例外。

本次没有修改：
- `src/`（后端）→ 不需要 `npm run typecheck` 以外的动作，也不需要重启服务
- nginx 配置
- 数据库结构 / 数据
- 图片资源（没有压缩、没有 WebP 转换）

---

## 6. 测试环境与限流注意

- 测试账号：`301@301.group`（不同脚本用不同昵称，删除有昵称护栏）
- 会真的发送验证码邮件（注册三段式需要反推验证码）
- 作业 verify 限流：**30 次 / 10 分钟 / IP**；同一 token **300 次 / 小时**（`src/routes/classes.ts:1201-1202`）
- 注册发码：**1 次 / 分钟 / 邮箱**；IP 60 次/10 分钟；注册 IP 40 次/10 分钟（`src/routes/auth.ts:46-54`）
- 连续跑 `assign-e2e` + `assign-ui-e2e` + 响应式审计会触发 429。建议：
  1. 每次运行之间等待 10 分钟；或
  2. 只清**精确的限流键**（先 SCAN 确认，禁止 FLUSH）：
     ```bash
     sudo redis-cli -n 1 --scan --pattern 'aiq:assign:verify:ip:*'
     # 确认后只删除对应 IP 的单个键
     ```
  - 红线：Redis 只允许操作 db1 的 `aiq:*`，**永不 `FLUSHDB` / `FLUSHALL`**。

### 测试脚本清理注意事项

- `cleanupUser(BASE, email, expectedNickname)` 只有昵称匹配才删账号。若上次运行失败留下账号，用对应脚本的昵称清理；不要扩大删除范围。
- `SMOKE_FORCE=1` 是绕过昵称护栏的开关，只能在确认该账号是测试账号时使用。

---

## 7. 红线（从 `HANDOFF.md` §2 摘录，必须遵守）

1. **绝对不要碰 `301_group` 数据库。** 本项目库是 `aiq_course`；任何 `mysqldump` / `DROP` / `DELETE` / `UPDATE` 必须显式带库名。
2. 改 nginx 前先备份，`nginx -t` 通过再 reload。
3. 不要删除历史内容：`/var/www/gaoshu`、`/home/ubuntu/web/talk`、`/etc/nginx/sites-available/yuehua.online.bak-relay-20260810`。
4. 端口 7999 不是空闲端口。
5. Redis 只清 `aiq:*`，永不 FLUSH。
6. `.env` 内容（SMTP 密码、数据库密码、`AUTH_SECRET`、`AI_IMAGE_API_KEY`、`AVATAR_MODERATION_API_KEY`）不得出现在任何输出、日志、前端代码里。
7. 301 组项目只读（`/home/ubuntu/301` 仅参考裁剪交互）。
8. 不压缩图片、不转 WebP（项目明确要求）。
9. 真实数据存在；改表结构前先备份。

---

## 8. 建议的收尾顺序（给 GPT）

1. 修掉 `scripts/responsive-audit.mjs` 的退出码和移动端自动缩放两个问题。
2. 等限流冷却后，在最终构建上跑 `script/assign-ui-e2e.mjs`（先）和完整响应式审计（后）；必要时分开跑，避免 30 次 verify 上限。
3. 补学生端 844×390 / 768×1024 / 390×844 审计；重点看监考条、创作台、横向溢出、安全区。
4. 补 844×390 主导航抽屉验证。
5. 看图确认 box-sizing 后桌面端控件没有视觉退化。
6. （如验收标准要求）补弹窗焦点管理、44px 触控目标和暗色模式检查。
7. 更新 `README.md` / `HANDOFF.md`，并同步任务状态。
8. 交付时附上：两条 E2E 的通过计数、5 个视口的审计摘要、监考条几何数据、剩余已知限制。
