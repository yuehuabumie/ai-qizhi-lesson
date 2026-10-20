# AI 启智课

小学人工智能通识课教学平台，面向 1–6 年级。线上站点：[yuehua.online](https://yuehua.online)。

**本仓库是服务器项目快照：Fastify 后端源码、已构建的 Vue 网站，以及独立运行时前端模块。仓库不含完整 Vue/Vite 开发源码。** 根目录 `src/` 是后端，`npm run dev` 启动 API；这里没有 `npm run build` 或 Vite 开发服务器。

运维背景与边界见 [HANDOFF.md](./HANDOFF.md)，上一轮未完成清单见 [HANDOFF-GPT-2026-10-20.md](./HANDOFF-GPT-2026-10-20.md)，本轮界面验收记录见 [UI-ACCEPTANCE-2026-10-20.md](./docs/UI-ACCEPTANCE-2026-10-20.md)。历史交接中的通过数只证明对应时间的构建，不能代替当前版本验收。

2026-10-20 本轮手机适配已于 **18:27:23（Asia/Shanghai）** 部署，生产全站五视口双主题 **544/544**、320/375px 窄屏 **56/56** 通过。预览中的扩展作业 UI 为 43/43、动态细节为 99/99；范围、证据与真机等剩余限制见本轮验收记录和 [结果摘要](./docs/ui-20261020/summary.json)。

## 产品行为

- 首页、课程体系、资源列表、视频列表、作品展厅允许匿名浏览；互动训练、教学工具、视频播放、资源下载、个人作品保存和点赞需要账号登录。
- 未登录不记录普通学习进度，包括内存和 `localStorage`。登录后的进度归账号，可跨设备同步；主题、学段等设备偏好保存在本机。
- 训练作品先保存为个人草稿，显式发布后才在公共展厅展示。普通个人作品署名取账号昵称。
- 教师可创建班级、管理最多 100 人的名单，发布 **AI 绘本、互动练习、课程任务**三类作业；课程任务可配套工具训练台。
- 学生从老师提供的作业链接进入，按名单核对姓名，无需注册普通账号。作业会话与普通账号会话分开；互动练习工作台的底部操作条记录本次作业成绩并提供提交入口。
- 教师可查看学生提交，并显式发布或撤下展厅作品。**教师发布班级提交时可选择署名**，这是普通个人作品署名规则的例外。
- 共有 13 个训练入口；其中绘本由独立 `storybook` 作业类型承载，其余 12 个可作为互动练习作业，清单见 `src/lib/assign-catalog.ts`。

主要 hash 路由包括：`#/curriculum`、`#/curriculum/m1` 至 `m4`、`#/lab`、`#/lab/:id`、`#/teach`、`#/resources`、`#/videos`、`#/gallery`、`#/gallery/:id`、`#/me`、`#/me/works`、`#/me/classes`、`#/me/classes/:id`、`#/me/classes/:id/assignments/:assignmentId` 和学生入口 `#/assign/:token`。

## 仓库结构与运行环境

```text
src/                 Fastify 后端：routes/ 与 lib/
prisma/              数据库模型
scripts/             API/UI 验收、运行时前端模块、安装与产物补丁
scripts/lib/         验收工具、Chromium CDP 驱动、响应式测量
site/                已构建的 Vue 网站；assets/ 包含入口与视图 chunk
site/uploads/        运行时用户上传内容（被 Git 忽略，部署必须保留）
docs/                本轮界面验收记录
package.json         后端依赖与命令
.env.example         环境变量模板；真实 .env 不入库
```

后端使用 Node.js 22、Fastify 5、TypeScript、Prisma 6、MySQL 8 和 Redis。前端产物使用 Vue 3、Pinia、Vue Router hash 路由、Element Plus 和 Tailwind。Tailwind 未启用 preflight；运行时模块必须自行处理作用域内的 `box-sizing`。

生产 API 位于 `127.0.0.1:3020`，由 `aiq-api.service` 管理；nginx 将 `/api/` 反代到它。静态目录 `/home/ubuntu/aiq-api/site` 由 `/var/www/yuehua.online` 软链引用。服务器项目目录本身不一定是 Git checkout，更新前应先比较现有文件，保留其他人的改动。

## 后端开发

在仓库根目录执行：

```bash
npm ci
cp .env.example .env
# 填写本机开发环境配置；不要把生产密钥写入脚本或提交
npm run db:generate
npm run typecheck
npm run dev
```

`npm run dev` 运行 `tsx watch src/index.ts`，默认监听 `127.0.0.1:3020`；`npm run typecheck` 是 `tsc --noEmit`，只检查后端 TypeScript。`npm start` 运行 API，生产环境由已有 systemd 服务启动。需要本机 MySQL、Redis、邮件等实际配置才能完整运行；生产安全 Cookie 的登录验收应通过同源 HTTPS 页面执行。

数据库结构由 `prisma/schema.prisma` 描述。已有真实数据时，**不要把 `npm run db:push` 当成日常启动步骤**；任何结构变更都先备份并审查迁移影响。

接口前缀为 `/api`，统一错误体为 `{"error":{"code":"...","message":"中文提示"}}`。主要域：

- `/health`：API、数据库与 Redis 健康状态。
- `/auth/*`：验证码、注册、登录、会话、资料与头像等。
- `/progress/*`：账号训练进度，合并时只升不降。
- `/works`、`/works/mine`、作品发布/撤下与点赞：公开作品和个人草稿。
- `/ai/image`、`/ai/storybook`：真实图片生成。
- `/classes/*`：教师班级、名单、作业、学生提交与展厅发布。
- `/assign/:token/*`：学生作业核名、会话、提交。

## 前端修改与安装

完整 Vue 源码需要从原开发机另行找回。本快照可维护的前端源码主要是 `scripts/*-studio.js` 和 `scripts/responsive-shell.js`：

- `storybook-studio.js`：绘本编排、真实生成、审查、作业入口和学生工作台。
- `class-studio.js`：班级/作业教师页面、弹窗、桌面与移动主导航入口。
- `gallery-studio.js`：展厅列表、详情和个人作品挑选发布。
- `me-studio.js`：个人资料、头像、密码和个人作品。
- `responsive-shell.js`：共享导航、表单、课程页与训练页等移动布局补充。

安装脚本会把模块复制到 `site/assets/`，并更新 `site/index.html` 的内容哈希参数，避免旧缓存。**编辑 `scripts/` 后必须运行对应安装脚本，线上才会使用新内容。** 仅改静态模块不需要重启 API 或 reload nginx。

例如在服务器 `/home/ubuntu/aiq-api` 更新本轮涉及的模块：

```bash
sudo node scripts/install-class-studio.mjs
sudo node scripts/install-storybook-studio.mjs
sudo node scripts/install-responsive-shell.mjs
```

如果将来取得完整 Vue 源码并生成了新的 `site/`，需在新产物就位后按顺序恢复全部补丁与运行时模块：

```bash
sudo node scripts/patch-prompt-builder.mjs
sudo node scripts/patch-storybook.mjs
sudo node scripts/patch-lazy-images.mjs
sudo node scripts/install-storybook-studio.mjs
sudo node scripts/install-gallery-studio.mjs
sudo node scripts/install-me-studio.mjs
sudo node scripts/install-class-studio.mjs
sudo node scripts/install-responsive-shell.mjs
```

`me`、`class` 等模块需要早于入口 bundle 加载以恢复深链接，安装脚本会安排位置。补丁依赖当前产物结构；锚点不匹配时应停止并检查，不能强行替换。不要单独重命名入口 chunk；它被其他视图共同引用，可能加载两份 Vue。

修改运行时模块可先使用 `scripts/preview-site.mjs`：它只监听本机 `127.0.0.1:3320`，从 `PREVIEW_SITE` 指定目录读取静态文件，以当前 `scripts/` 覆盖运行时模块，并将 `/api` 代理到本机 API。提供 `PREVIEW_TLS_KEY` 和 `PREVIEW_TLS_CERT` 时启用 HTTPS，以验证 Secure Cookie。预览文件服务不改生产静态目录，但 API 仍指向配置的后端；验收必须使用专用测试数据。

## 验收

本地无需服务的结构与审计工具检查：

```bash
node --test scripts/responsive-metrics.test.mjs scripts/lab-callbacks.test.mjs
npm run typecheck
```

`lab-callbacks.test.mjs` 检查编译产物中 12 个互动练习的 `markLab` 标识是否与作业目录一致；**它不等于逐个完成全部训练的浏览器验收**。

完整 API/UI 验收设计为在服务器上运行，需要已配置 API、MySQL、Redis 和无头 Chromium。验证码测试会真实发邮件，并通过本机 `sudo mysql` 读取测试验证码哈希；不能在普通开发机上直接运行这些脚本来远程访问生产库。

```bash
cd /home/ubuntu/aiq-api
node scripts/assign-e2e.mjs
```

浏览器页面应使用正确主机名 `https://yuehua.online`。服务器本机验证可通过 Chromium 参数把域名解析至本机，保留 nginx 虚拟主机选择和同源 Cookie：

```bash
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/assign-ui-e2e.mjs
```

**不要改成 `https://127.0.0.1`**：它可能命中服务器上其他站点的默认虚拟主机。浏览器驱动可通过 `E2E_BROWSER` 指定 Chromium；包含空格的参数使用 `E2E_BROWSER_FLAGS_JSON`，不要使用按空格拆分的旧变量传 host resolver 参数。

全站响应式审计：

```bash
AUDIT_WHOLE_SITE=1 AUDIT_OUTPUT=/tmp/aiq-responsive-final \
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/responsive-audit.mjs
```

输出目录保存 `report.json` 与页面截图；失败返回非零退出码。审计以请求的视口宽度比较溢出，并检查移动端自动缩小、弹窗边界、学生操作条占位等；小触控目标列表仍需结合实际可点击包装元素人工判断。明暗主题使用真实的 `html.dark` 切换。

`scripts/public-mobile-audit.mjs` 无需账号，检查 320/375px 的 14 个公开页面、双主题。`scripts/mobile-detail-audit.mjs` 使用独立测试账号，补查百人名单、长姓名/标题、作品详情、个人作品/展厅弹窗、断网重试、带照片的提交失败恢复和预览请求竞态。它们同样接受 `E2E_BASE`、`AUDIT_OUTPUT` 与浏览器参数；细节套件也必须与其他账号套件串行运行。

其他已有套件为 `smoke-auth.mjs`、`smoke-progress.mjs`、`gallery-e2e.mjs`、`me-e2e.mjs`。旧 `cdp-e2e-auth.mjs` 依赖原开发机的 Windows/Edge/SSH 设置，仅作历史参考；优先使用当前服务器 Chromium 套件。最终通过数以本轮验收记录为准。

测试账号与限流要求：

- 脚本默认测试邮箱为 `301@301.group`。班级套件和响应式审计可通过 `ASSIGN_E2E_EMAIL` 指定专用邮箱；其他套件按各自环境变量约定使用。
- 删除测试账号前校验预期昵称。昵称不匹配时应停止、确认归属；**不要设置 `SMOKE_FORCE=1` 绕过护栏**。同一测试邮箱的套件必须串行运行，不能互相清理账号。
- 学生核名 `/assign/:token/verify` 有每 IP 30 次/10 分钟、每 token 300 次/小时限制。连续套件需要等待冷却；HTTP 429 不能当成页面故障或继续等待成功页面。
- 如确需清理测试限流，只能检查并删除 **Redis db1 中与本次测试精确对应的 `aiq:` 键**；禁止清空数据库或整个项目前缀。

## 部署边界

- 本项目数据库仅为 **`aiq_course`**。不得操作 `301_group`、其他项目库或旧站内容；SQL 和备份命令必须显式指定库名。
- Redis 限流使用 **db1、`aiq:` 前缀**。禁止 `FLUSHDB`、`FLUSHALL`。
- `.env`、SSH 凭据、邮件/AI/API 密钥不得提交或出现在输出与浏览器资源中。
- `site/uploads/` 是用户上传内容，**不是构建产物**。作品插画、头像及其他上传文件都要保留；不能删除 `site/` 来获得“干净构建”。
- 本轮只更新具体模块、安装脚本和静态入口时，应先备份这些原文件，再安装并验证内容哈希。不要整目录覆盖上传内容。回滚时恢复同一批文件和匹配的 `index.html`。
- 更换完整静态产物时，按 [HANDOFF.md §5](./HANDOFF.md#5-怎么改动各层) 保存并恢复上传目录；不要删除 `/var/www/yuehua.online` 软链。
- 纯前端变更不需要重启 `aiq-api.service`。后端或 nginx 变更属于单独的部署步骤；改 nginx 前备份，检查 `nginx -t` 通过后再 reload。
- 按项目要求，不进行图片压缩或 WebP 转换。

## 已知限制

完整 Vue 源码尚未包含在此快照，运行时路由和导航注入依赖既有构建结构，前端重新构建后需重新验证。忘记密码没有自助找回；跨标签页登录态需刷新同步；`send-code` 对已注册邮箱返回 409；数据库尚无正式迁移历史。这些既有产品/技术决定见交接文档。

移动端自动化使用 Chromium CDP 模拟。iOS Safari、真实软键盘、安全区和浏览器地址栏变化仍需要真机复核，不能由模拟器结果替代。
