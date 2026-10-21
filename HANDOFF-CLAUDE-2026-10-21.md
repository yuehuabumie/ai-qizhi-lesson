# 交接文档（给下一个 AI）：课堂教学三入口与智能备课键盘发送

> 当前生产已于 2026-10-21 23:29:48（Asia/Shanghai）更新至 `KJsvrJco`，包含重构、统一布局、闪回修复、智能体加载提示、紧凑发送按钮和清晰的教师头像；运行器文案于 23:00:55 在空闲时更新并重启。备份与哈希见 [最新发布记录](./docs/DEPLOYMENT-TEACHING-LAYOUT-2026-10-21.md)。下方“尚未部署”和旧版本描述保留为历史过程。

> 用户已明确要求提交 GitHub。当前提交包含 `agent-runtime/aiq-agent/` 自有源码裁剪版原型，仅本地验证，生产仍用原 DSH 镜像；继续开发前阅读该目录 README，不能直接在原镜像启用 `PREP_AGENT_ENGINE=aiq`。

> 后续本地复核发现并修复入口观察器自循环、发送草稿丢失和跨会话发送回调问题，167 项浏览器检查通过；尚未部署。当前本地修改与下方历史生产版本不同，详见 [交接复核记录](./docs/HANDOFF-REVIEW-2026-10-21.md)。

> 后续获准结构重构：备课源码拆至 `scripts/prep/`，显式打包与测试入口替代正则注入，最终本地浏览器 169 项、模块检查 4 项通过，版本 `9z25VvW-`，仍未部署。维护与验证说明见 [前端重构记录](./docs/FRONTEND-REFACTOR-2026-10-21.md)。

> 最新本地布局调整：三个教学入口统一移至页面顶部，对齐内容宽度和标题，工具箱保留六类二级工具。浏览器检查累计 199 项通过，模块检查 4 项通过；本地版本 `cfTHdtiG`，尚未部署，详见上述重构记录末节。

- 日期：2026-10-21（Asia/Shanghai）
- 开发仓库：`C:\Users\21886\Desktop\codex\ai-qizhi-lesson`
- 生产站点：<https://yuehua.online>
- 本地提交：`a5ea75ae82b8afe477f5bd6e8889dc2a46bccaa5`
- 提交说明：`feat: unify teaching entries and prep keyboard send`
- 推送状态：**未推送 GitHub**（用户未要求）
- 工作区：写这份交接前是干净的

## 0. 一句话现状

需求已实现、测试、发布到生产，公网三个静态文件的 SHA-256 与本地验收包逐字节一致。剩余缺口只有两项：没有教师登录态下的生产页面截图，以及首次成功发布的终端输出丢失导致备份目录的具体 UTC 时间戳未记录。

## 1. 用户需求

1. 智能备课输入框：Enter 发送，Shift+Enter 换行；中文输入法组合期间不能误发送。
2. 不新增「智能备课」独立顶栏标签，把智能备课放进「课堂教学」。
3. 班级管理也放进去，统一为三个页内入口：**教师工具箱、智能备课、班级管理**。
4. 进入这三个页面中的任一页时，顶栏「课堂教学」保持选中。
5. 更新测试与教师文档，发布生产并验证，提交本地代码。

注意：用户明确纠正过入口名称是「教师工具箱」（不是「教室工具箱」）。

## 2. 实现结果

### 2.1 页内三入口

入口统一由 `scripts/prep-studio.js` 注入，`class-studio.js` 不再单独注入顶栏或抽屉标签。

- `TEACH_ENTRIES`：三个入口的 key、href、文案和图标。
  - `teach` → `#/teach` → 教师工具箱
  - `prep` → `#/prep` → 智能备课
  - `classes` → `#/me/classes` → 班级管理
- `teachSection()`：识别 `/teach`、`/prep`（含 `/prep/...`）、`/me/classes`（含详情子路由）。
- `teachingTarget(section)`：
  - `/teach`：`.teach-body`，插在 `.teach-tabs` 前。
  - `/prep...`：`.prep-page .prep-wrap`，作为第一个子元素。
  - `/me/classes...`：`.cls-studio-root .cls-container`，作为第一个子元素。
- `syncTeachingHub()`：只保留一个 `[data-teach-hub]`，清除重复节点，更新 `aria-current="page"` 和 active 样式。
- `installTeachingHub()`：`MutationObserver` + `requestAnimationFrame` 调度，监听 `hashchange`；Vue 重渲染后仍能保持入口。
- `syncTeachNav()`：同步顶栏（含移动抽屉）中 `header.aiq-navbar a[href="#/teach"]` 的 `is-active`、`aria-current="page"`；离开教学路由时清除。
- 全屏备课 `.prep-page.is-fullscreen` 下隐藏页内入口。

### 2.2 键盘发送

在 `scripts/prep-studio.js` 的键盘处理器中：

```js
if (e.target.id === 'prep-message' && e.key === 'Enter' && !e.shiftKey) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  send()
}
```

- 普通 Enter 发送，不插入换行。
- Shift+Enter 不拦截，保持浏览器默认换行。
- `isComposing` 或 keyCode 229 期间直接返回，避免输入法选词时误发送。
- 输入提示改为：`Enter 发送 · Shift+Enter 换行`。
- 占位提示包含：`输入学科、年级和课题，可粘贴或拖放教材、班级名单…`。

### 2.3 CSS

在 `scripts/prep-studio.js` 的样式注入中新增：

- `.teach-hub,.teach-hub *{box-sizing:border-box}`：修复 390px 下内容盒模型导致的 10px 横向溢出。
- `.teach-hub`：胶囊式容器，`width:max-content; max-width:100%`。
- 深色主题 active 文字使用 `#93b4ff`，背景 `#172038`，对比度验收 ≥ 4.5:1。
- `@media(max-width:639px)`：三列网格，每个触控目标至少 44px 高。
- `.prep-page.is-fullscreen .teach-hub{display:none}`。

### 2.4 旧导航清理

`scripts/class-studio.js` 删除了：

- `NAV_ICON`、`navActive`、`syncNavActive`
- `injectDesktopNav`、`closeDrawer`、`injectDrawerNav`
- `scheduleNavSync`、`installNavTab`
- `[data-cls-nav-tab]` 相关 CSS
- `boot()` 中的 `installNavTab()`

保留注释说明：班级管理入口由「课堂教学」页内导航统一提供。线上和本地都不再出现旧的 `data-cls-nav-tab` / `data-prep-nav` 标记。

## 3. 涉及文件

源码与生产静态副本是两份文件，必须同步修改：

| 源文件 | 生产副本 |
|---|---|
| `scripts/prep-studio.js` | `site/assets/prep-studio.js` |
| `scripts/class-studio.js` | `site/assets/class-studio.js` |
| — | `site/index.html`（更新 `?v=` 版本号） |

测试/文档：

- `scripts/navigation-components-e2e.mjs`：重写为无 Vue scope、无后端的教学入口测试，9 项。
- `scripts/prep-components-e2e.mjs`：增加键盘提示、Shift+Enter 换行、输入法 Enter 不发送、Enter 发送不换行，共 78 项。
- `scripts/prep-navigation-e2e.mjs`：全站编译页面导航、8 个顶栏入口、三入口、移动抽屉、全屏、`班级管理 → 教师工具箱 → 智能备课` 路由往返，20 项。
- `scripts/responsive-audit.mjs`：移动抽屉改为等待 `a[href="#/teach"]`，检查无旧注入标记，再进入页内入口；该项本轮作为脚本同步更新，未计入最终五个套件的通过数。
- `docs/SMART-PREP-USER-GUIDE.md`：教师入口、移动端和键盘说明。
- `docs/SMART-PREP-VERIFICATION-2026-10-21.md`：本轮实现、测试、发布记录和限制。

## 4. 测试

最终通过数（Windows Edge，真实 CDP；本轮五个套件）：

| 套件 | 结果 |
|---|---|
| `scripts/navigation-components-e2e.mjs` | 9/9 |
| `scripts/prep-components-e2e.mjs` | 78/78 |
| `scripts/prep-navigation-e2e.mjs` | 20/20 |
| `scripts/teaching-components-e2e.mjs` | 43/43 |
| `scripts/prep-preview-e2e.mjs` | 12/12 |

Windows 复跑示例（Git Bash）：

```bash
export E2E_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
cd /c/Users/21886/Desktop/codex/ai-qizhi-lesson

node scripts/navigation-components-e2e.mjs
node scripts/prep-components-e2e.mjs
node scripts/prep-navigation-e2e.mjs
node scripts/teaching-components-e2e.mjs
node scripts/prep-preview-e2e.mjs
```

在服务器/Linux 上，`scripts/lib/cdp-kit.mjs` 默认使用服务器上的 Playwright Chromium，无需设置 `E2E_BROWSER`。

注意：

- `prep-navigation-e2e.mjs` 自己启动本地 HTTP 服务并模拟 API，不访问生产，也不修改教师资料。
- `responsive-audit.mjs` 是带真实 API/测试账号/写操作的审计，不是纯静态测试；不要为了验证本轮前端而随意重跑。
- Windows 上访问生产的 Edge 如果报 `ERR_CONNECTION_CLOSED`，而 `curl` 能访问，通常是系统代理；加 `E2E_BROWSER_FLAGS_JSON='["--no-proxy-server"]'`。
- 生产首次加载入口脚本在本机约 5 秒，登录页约 10 秒才挂载；线上检查等待时间至少给 30–60 秒。

## 5. 生产发布

本轮只改静态前端，未改 API、数据库、worker 或 nginx，不需要重启服务。

### 5.1 线上版本和哈希

- `site/assets/prep-studio.js?v=c-sj5SMk`
  - SHA-256 `73eb23e5232413fb0e4e4998e59c294b5b96d8b91ed9ba62123d899469d95f5e`
- `site/assets/class-studio.js?v=cUxMX2Ng`
  - SHA-256 `714c4c5f63607e3f858991592511d6d3a2a28986530f64503e5db010e6add595`
- `site/index.html`
  - SHA-256 `165e0c9db6279a7323d2a93450a793a68344e6dec56c7e396dfdcd2e6600889f`

公网 `https://yuehua.online/` 以及上述两个资源文件的 SHA-256 与本地验收载荷完全一致；线上 index 已引用 `c-sj5SMk` / `cUxMX2Ng`。

### 5.2 发布过程和一次“安全中止”

第一次发布（桌面密码窗口输入密码）实际成功，但该工具的终端输出因连接内部错误没有回传。

第二次重试在远端校验阶段失败：

```text
AssertionError: Production changed since base: site/assets/prep-studio.js
REMOTE_EXIT=1
```

原因是线上 `prep-studio.js` 已经是第一次发布后的新版本，第二次部署器仍拿旧基线哈希比较，所以在**备份和写入之前**主动中止。不是文件损坏，也没有覆盖任何文件。当前线上文件与发布包一致。

部署器位于仓库外的 `.local-tools/`：

- `.local-tools/deploy-prep-hub.py`：只允许三个目标文件 + `manifest.json`；校验基线；创建 root 备份；按“两个资源 → `index.html`”顺序原子替换；保留 uid/gid/mode。
- `.local-tools/run-prep-hub-release.py`：上传并执行部署器；密码只从环境变量或 Windows 原生凭据窗口读取，不写入磁盘、argv 或远端命令。
- `.local-tools/prep-teaching-hub-20261021.tgz`：本轮发布包；其 `manifest['base']` 是发布前的旧基线，**当前已过期**。

如果还需要再次发布，先做下面之一，不要直接重跑旧包：

1. 把 manifest 的 `base` 更新为当前生产文件（按去掉 CRLF 后的 LF 字节计算）；或
2. 修改部署器，允许“目标文件已经等于 payload”作为幂等成功，但仍要对真正不同的文件保留基线保护。

备份由部署器在写入前创建于主服务器：

```text
/home/ubuntu/aiq-api/.backups/prep-teaching-hub-<UTC 时间戳>/before.tgz
```

具体时间戳**没有记录**，因为首次成功发布的输出丢失。需要的话用只读 SSH 列目录，不要猜路径。

### 5.3 公网验收结论

- `/teach` 未登录会跳转 `#/login?redirect=/teach`，这是原有权限行为，不是 hub 失败。
- 登录页顶栏仍是 8 个入口，没有独立的「智能备课」「班级管理」顶栏标签。
- 登录页加载的 JS 资源均返回 200；`prep-studio.js?v=c-sj5SMk`、`class-studio.js?v=cUxMX2Ng` 均实际加载；60 秒观察无前端 `error` / `unhandledrejection`。
- 线上脚本字符串检查确认包含：`教师工具箱`、`课堂教学入口`、`Enter 发送`、`Shift+Enter`、`isComposing`、`data-teach-hub`。
- 线上 `class-studio.js` 不再包含 `data-cls-nav-tab` / `data-prep-nav`。

没有完成的部分：

- 没有教师登录态下的线上 `/teach`、`/prep`、`/me/classes` 截图。`.local-tools/prep-production-browser.mjs` 依赖的 `production-browser-auth.json` 当前不存在，不能凭它直接跑。
- 三个页面的交互行为由本地同字节的前端套件覆盖（9/9、78/78、20/20、43/43、12/12）；如果要做线上登录态验收，请使用真实教师账号或用户明确授权的临时测试账号，不要把 Cookie/会话写入仓库。

## 6. 安全和运维红线

- 本轮仓库、文档、提交中**没有写入任何 SSH 密码、Cookie 或会话令牌**。
- 不要从会话记录里挖密码；不要在自己的命令中内联密码；使用原生凭据窗口或环境变量。
- 用户在聊天中出现过临时 SSH 凭据，建议尽快失效/更换。
- 不要推送 GitHub，除非用户明确要求。
- 这台服务器上还有多个无关站点；不要改 nginx、数据库或其他站点的内容。
- 生产数据库只允许 `aiq_course`，且本轮没有数据库操作。

## 7. 建议的下一步

1. 如果用户要补齐线上人工验收：登录后检查
   - `/teach`：hub 在 `.teach-tabs` 前，active 为「教师工具箱」，顶栏「课堂教学」有 `aria-current`；
   - `/prep/...`：hub 是 `.prep-wrap` 第一个子元素，active 为「智能备课」；
   - `/me/classes`：hub 是 `.cls-container` 第一个子元素，active 为「班级管理」；
   - 390px：三列、44px 触控目标、无横向溢出；全屏备课隐藏 hub。
2. 如需记录备份路径：只读 SSH 执行 `ls -dt /home/ubuntu/aiq-api/.backups/prep-teaching-hub-*`，不要写入或删除。
3. 如需再次部署：先按 §5.2 更新基线/幂等逻辑，再走同一部署器；保持“资源先、HTML 后”的顺序。
4. 若要重跑全站响应式审计，先阅读 `README.md` 的测试账号、限流和清理护栏；不要清空 Redis 或数据库。

## 8. 相关文档

- `docs/SMART-PREP-VERIFICATION-2026-10-21.md`：本轮完整验收和发布记录。
- `docs/SMART-PREP-USER-GUIDE.md`：教师使用说明。
- `README.md`：仓库结构、运行方式和全站验收命令。
- `HANDOFF.md`：服务器侧长期交接与红线。
