# AI 启智课

小学人工智能通识课教学平台。面向 1–6 年级，4 个模块 × 3 个学段，13 个课堂可演示的互动训练。

线上：<https://yuehua.online>

---

## 这是什么

一个 Vue 3 单页站 + Fastify 后端。前端是纯静态产物，后端提供账号、进度同步和作品展厅。

**核心产品逻辑**（改动时容易踩，先读这段）：

- **浏览开放，写入要登录。** 首页、课程体系、资源列表、视频列表、作品展厅都能匿名看；
  互动训练、课堂教学工具、视频播放、资源下载、作品上传与点赞需要登录。
- **未登录完全不记录进度**——不写内存也不写 `localStorage`。这是刻意的：
  记在一个刷新就没的地方，比不记更糟，用户会以为存下来了。
- **进度归账号，不归设备。** 换设备、换浏览器登录同一个账号，进度都在。
  只有主题/学段/点名名单留在本机（那是「这台设备」的偏好，不是学习数据）。
- **作品署名一律取账号昵称。** 客户端传 `author` 会被服务端丢弃——展厅是公开的，
  允许自填作者名等于给冒名留门。

---

## 技术栈

| 层 | 用了什么 |
|---|---|
| 前端 | Vue 3.5 + Vite 6 + Pinia + Vue Router（**hash 路由**）+ Element Plus + Tailwind |
| 后端 | Node 22 + Fastify 5 + Prisma 6 + Zod + jose(JWT) + nodemailer + ioredis |
| 存储 | MySQL 8（`aiq_course`）+ Redis db1（只用于限流，键前缀 `aiq:`） |
| 部署 | nginx 反代 `/api/` → `127.0.0.1:3020`，前端静态托管 |

Tailwind 关掉了 `preflight`（`corePlugins.preflight: false`）——Element Plus 自带样式重置，
两个一起上会把按钮和输入框打回原形。

Element Plus 的图标是**全局注册**的（`main.ts` 里遍历注册），所以模板里可以直接写
`<Clock />`，不用 import。

---

## 目录结构

下面是**开发机仓库**的全貌。服务器上 `/home/ubuntu/aiq-api/` 只有
后端（`src/`、`prisma/`、`package.json`）、前端构建产物（`site/`）、
`scripts/` 和这两份文档——**前端源码不在服务器上**，服务器上的 `src/`
是后端代码，不要按下面的树去找前端的 `api/`、`views/`。

```
.
├── src/                    前端源码
│   ├── api/                按域拆的接口封装（auth / progress / works）
│   ├── stores/             user（登录态）、app（进度、作品、本机偏好）
│   ├── composables/        useRequireLogin（操作级门禁）
│   ├── utils/              request（fetch 封装 + ApiError）、progressSync（同步队列）
│   ├── views/              页面
│   └── router/             路由 + 守卫
├── aiq-api/                后端（独立的一包，Vite 不碰它）
│   ├── src/routes/         health / auth / progress / works / ai
│   ├── src/lib/            db / redis / auth / rate-limit / mailer / verify-code
│   ├── prisma/schema.prisma
│   └── scripts/            backup-db.sh（备份）+ smoke-*.mjs / *-e2e.mjs（验收）+ *-studio.js（运行时页面）
├── site/                   构建产物（npm run build 生成）
└── HANDOFF.md              服务器运维交接文档
```

---

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

开发时 `/api` 由 Vite 代理到 `https://yuehua.online`（见 `vite.config.ts`）。
**这样浏览器视角始终同源**，cookie 行为和生产完全一致——如果改成跨域直连后端，
`SameSite=Strict` 的 cookie 在开发环境根本不会被带上，会白排查半天。

```bash
npm run typecheck    # vue-tsc --noEmit，提交前必须 0 错误
npm run build        # 先 typecheck 再 vite build → site/
```

> `emptyOutDir` 是 `false`，所以 `site/` 会积累上一版的哈希文件。
> 要干净产物就先 `rm -rf site` 再 build。

---

## 后端

代码在 `aiq-api/`，**和前端是两套依赖**，`npm install` 要在 `aiq-api/` 里单独跑。

```bash
cd aiq-api
cp .env.example .env     # 然后填 DATABASE_URL / REDIS_URL / AUTH_SECRET / SMTP_*
npm install
npx prisma generate
npx prisma db push       # ⚠️ 见下
npx tsx src/index.ts     # 开发模式启动
```

> ⚠️ **`db push` 在需要删列时会静默丢数据。** 项目初期没有真实数据时用它是图快；
> **现在库里已经有真实用户的学习进度和作品了，再改 schema 必须先把备份跑一遍，
> 并认真考虑改用 `prisma migrate`。** 学生的进度丢了就是事故。

环境变量见 `aiq-api/.env.example`，每个都有注释。缺一个就崩，不带病运行。

### 接口

前缀 `/api`。错误体统一 `{"error":{"code":"...","message":"中文提示"}}`，
前端直接 `ElMessage.error(e.message)`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ok,db,redis}`，不鉴权 |
| POST | `/auth/send-code` | 发六位验证码 |
| POST | `/auth/verify-code` | 校验 → 换 `proof` |
| POST | `/auth/register` | 凭 `proof` 建号 + 自动登录 |
| POST | `/auth/login` · `/auth/logout` | 会话 |
| GET | `/auth/me` | 当前用户；未登录返回 200 + `{user:null}`（刻意不刷 401，见 `routes/auth.ts` 注释） |
| GET | `/progress` | 拉全量进度（按 labId 的 map） |
| PUT | `/progress/labs/:labId` | 单条训练进度，合并语义（只升不降） |
| PUT | `/progress/quiz` | 知识挑战赛最好成绩（取 max） |
| DELETE | `/progress` | 清空进度（用户显式重置） |
| POST | `/progress/import` | 旧 `localStorage` 一次性导入（合并，非覆盖） |
| GET · POST | `/works` | 展厅列表（开放）/ 建作品（登录） |
| DELETE | `/works/:id` | 仅本人，否则 403 |
| POST · DELETE | `/works/:id/like` | 点赞 / 取消，幂等（重复点赞不报错也不重复计数） |
| POST | `/ai/image` | 提示词工坊真实出图（登录；账号 10 次/小时、IP 80 次/小时；z-image 约 8–10 秒、qwen-image 约 40–60 秒，一次最多 4 张） |
| POST | `/ai/storybook` | 故事绘本逐页插画（登录；账号 10 次/小时、IP 80 次/小时；一次最多 4 页，`images` 按页序对位、失败页为 `null`） |

### 注册为什么要三段式

`send-code` 存 `sha256(email + code)`；`verify-code` 命中后生成一个一次性 `proof`
（32 随机字节）并把它的哈希写回同一行；`register` 凭 `proof` 定位并消费。

`proof` 的作用是把「邮箱已验证」这个事实**安全地绑定到最终那次注册请求上**——
防重放、防拿别人的验证码注册。

进度合并用单条原子 SQL（`ON DUPLICATE KEY UPDATE` + `GREATEST`），
不是先读后写——并发下先读后写会丢高分（两个请求都读到 0，写 90 和 80，最终 80）。

---

## 验收

验收脚本在 `aiq-api/scripts/`，分两层：API 冒烟（curl，服务器上就能跑）和
真实浏览器端到端（CDP 驱动 Edge，需要开发机）。

**冒烟（服务器上直接跑，默认打 `http://127.0.0.1:3020`）：**

```bash
cd /home/ubuntu/aiq-api
node scripts/smoke-auth.mjs       # 注册/登录/会话/限流/防枚举，33 项
node scripts/smoke-progress.mjs   # 进度合并/并发取高分/导入/清空，37 项
```

- `SMOKE_BASE` 指向别的地址（如线上），默认本地 3020
- `SMOKE_EMAIL` 换测试邮箱（默认 `301@301.group`）
- `SMOKE_KEEP=1` 保留测试账号（默认跑完即删）

**真实浏览器验收（开发机，Windows + Edge + ssh.exe）：**

```bash
SSH_PASS=... node scripts/cdp-e2e-auth.mjs   # 注册 → 刷新仍登录 → 退出 → 再登录
```

- `E2E_BASE=http://localhost:5173` 打本地 dev，不设则打线上
- `E2E_FLUSH=1` 先清限流键（反复跑会被自己的限流挡住）
- `KEEP=1` 保留测试账号（默认跑完会删）

故事绘本页不是 `LabPlayView` 里的组件了：`scripts/storybook-studio.js` 在运行时
用更高优先级的静态路由接管 `/lab/storybook`，实现「编排 → 生成 → 审查 → 提交展厅」
三段式与成书拼接预览。重新构建前端后需
`sudo node scripts/install-storybook-studio.mjs` 重新挂载（详见 HANDOFF §5）。

**服务器上也能跑的真实浏览器验收**（用本机缓存的 Chromium，直连 CDP）：

```bash
node scripts/gallery-e2e.mjs   # 成果展厅 83 项（含个人草稿挑选发布/撤下）
node scripts/me-e2e.mjs        # 我的页面 63 项（下拉入口/资料/头像裁剪/改密码/个人作品）
```

**跑之前确认测试邮箱没被真人占用。** 脚本跑完会删账号，撞上真人的号会把人家的
进度清空——脚本里为此加了护栏：**账号已存在但昵称不是本脚本的测试昵称时，
拒绝清理并直接退出**（确认真能删，再设 `SMOKE_FORCE=1` 重跑）。

「我的」页与个人作品页同样是运行时模块：`scripts/me-studio.js` 接管 `/me` 与
`/me/works`，`scripts/gallery-studio.js` 接管 `/gallery`。训练页保存的作品先进入
个人作品库（草稿），在个人作品页或成果展厅显式发布后才公开；展厅的「发布我的作品」
就是从个人草稿里多选发布。重新构建前端后需依次挂载：

```bash
sudo node scripts/install-storybook-studio.mjs
sudo node scripts/install-gallery-studio.mjs
sudo node scripts/install-me-studio.mjs   # 必须排在入口 bundle 之前（脚本会自动挪）
```

头像由浏览器裁剪成 512×512 JPEG 后上传，服务端校验格式与魔数并做 AI 安全检查，
文件保存在 `site/uploads/avatars/`（部署时和 `site/uploads/works/` 一起保留，
见 HANDOFF §5）。

---

## 部署

**服务器侧的完整交接见 [`HANDOFF.md`](./HANDOFF.md)**，那里有红线、现状速查和运维步骤。
一句话版本：

- 前端：本地 `npm run build` → `tar` → `scp` → 服务器上原子换目录
- 后端：`systemctl restart aiq-api`
- nginx：改前备份，改后先 `nginx -t` 再 `reload`

---

## 已知限制

- **忘记密码没有自助找回**，本期不含重置流程
- 跨标签页登录态不会自动刷新（`ensureLoaded()` 只探活一次），刷新即正常
- `send-code` 对已注册邮箱返回 409，会暴露邮箱是否注册过（学校场景 UX 优先，风险接受）
- 数据库 schema 仍在 `db push` 阶段，没有迁移历史

---

## 历史

本站域名原本是「高校数学」的 relay 站，后端早已停止监听。
2026-10-15 重建为静态站，同日起逐步加上后端、账号体系、内容门禁和作品服务端化。
历史内容（`/var/www/gaoshu` 等）都还在服务器上，未清理。
