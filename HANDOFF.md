# AI 启智课 · 服务器侧交接文档

**写给在 `43.131.233.40` 上干活的 agent。** 你手上只有这台服务器，没有开发机的上下文，
所以下面把「为什么」也写上了——只知道怎么做、不知道为什么要这么做的人，遇到意外时
没法判断该不该变通。

写于 2026-10-16。开发侧（Claude Code）已完成 P0–P7 并全部上线。

---

## 0. 一句话现状

`https://yuehua.online` 现在是一个带账号体系的 Vue 3 单页站 + Fastify 后端。
前端（含登录注册、内容门禁、作品展厅）**已于 2026-10-16 发布**。

三套端到端验收对着**线上真实产物**跑过，全绿：

| 套件 | 覆盖 | 结果 |
|---|---|---|
| P5 | 进度云端同步 + 旧数据迁移 | 42/42 |
| P6 | 内容门禁（该拦的拦、该开的开） | 38/38 |
| P7 | 作品服务端化 + 越权防护 | 54/54 |

**P8 的运维收尾（第 3 节）里，3.1（备份 cron）和 3.2（nginx 兜底）已于
2026-10-16 完成并验证**——3.2 顺带修掉了原配置的一个缺陷（见该节）。
剩下 3.3（旧前端目录，观察一两周再删）和 3.4（证书，12 月底前瞄一眼）都是不急的巡检项。

同日还做过一轮全面代码审查并按结果修复上线（登录错误计数的判定顺序、进度导入的
防灌水与去重、脚本删号护栏、`package.json` 依赖声明补全等），后端已重启、两套
smoke 全绿（33/33、37/37）。行为细节以当前代码和脚本注释为准。

**2026-10-19 成果展厅升级**：列表/详情按作品类型渲染不同内容，新增
`/gallery/:id` 深链接；作品插画改为服务端落盘（`works.images` +
`site/uploads/works/`），绘本阅读器逐页对齐真实插画。展厅浏览器验收
**76/76**（`node scripts/gallery-e2e.mjs`）。

**2026-10-19 我的页面与个人作品**：新增 `/me`（昵称、头像、改密码）与
`/me/works`（个人作品管理）；训练页与创作台保存的作品先进入个人作品库（草稿），
在「我的作品」或成果展厅显式发布后才公开。头像支持浏览器裁剪后上传（≤2MB），
服务端 AI 安全检查后落盘 `site/uploads/avatars/`。桌面入口在右上角头像下拉
「我的主页」（顶部导航不重复占位，移动端保留抽屉入口）。验收：`me-e2e` **63/63**；
`gallery-e2e` 扩到 83 项、**82 通过**，唯一失败项是测试机公网回环中断期间
「用本站图片做远端源」被 SSRF 正常拒绝，已改用公网图片源单独复核下载链路通过，
公网回环恢复后应复跑该套件。

---

## 1. 服务器现状速查

| 项 | 值 |
|---|---|
| 后端代码 | `/home/ubuntu/aiq-api`（TypeScript，`tsx` 直接跑源码，无构建步骤） |
| 后端服务 | systemd `aiq-api.service`，`active` + `enabled`，监听 `127.0.0.1:3020` |
| 前端静态文件 | `/home/ubuntu/aiq-api/site`（67 个文件，属主 `www-data:www-data`）；`/var/www/yuehua.online` 是指向它的软链（2026-10-16 合并，nginx 配置未动） |
| AI 出图 | 后端 `POST /api/ai/image`（工坊候选）与 `POST /api/ai/storybook`（绘本逐页）代理阿里云 MaaS，当前模型 `z-image-turbo`（原生 multimodal-generation，一次 1 张、后端 2 路并发，4 张约 8–10 秒；4 并发会触发上游 429；每次调用随机 seed，不传 seed 时同提示词会像素级相同）。密钥只在 `.env`；两个训练的前端都是构建产物补丁（见 §5） |
| 个人作品 / 头像 | `/me`、`/me/works` 是运行时模块（`me-studio.js` + `install-me-studio.mjs`，见 §5）。作品默认草稿，显式发布才进展厅。头像裁剪后上传，落盘 `site/uploads/avatars/`；审核用 `AVATAR_MODERATION_*`（DeepSeek，OpenAI 兼容），失败/超时按放行（fail-open），密钥只在 `.env` |
| 上一版前端 | `/var/www/yuehua.online.old-20261016-0027`（保留中，见 3.3） |
| nginx 站点 | `/etc/nginx/sites-available/yuehua.online`（已软链到 `sites-enabled`） |
| 数据库 | MySQL `aiq_course`，5 张表，约 256 KB |
| 数据库账号 | `aiq_user@127.0.0.1`，密码在 `/home/ubuntu/aiq-api/.env`（chmod 600） |
| Redis | `127.0.0.1:6379` **db1**，键前缀 `aiq:`（只用于限流） |
| 证书 | `/etc/letsencrypt/live/yuehua.online/`，**2026-12-28** 到期，certbot 自动续 |
| 运行时 | Node v22.22.2 / npm 10.9.7 |
| 备份目录 | `/home/ubuntu/backups/aiq/` |

**这台机器上还跑着另外 4 个站**，都和本项目无关：
`301.group`(:3000 next-server) · `astra-rpg.online`(:8000 + :8765) · `yuehua.fun`(静态) ·
`yuehua.work`(:9001 + :8080)。改 nginx 时手别抖。

**健康检查三连**（先跑这个再怀疑别的）：

```bash
systemctl status aiq-api --no-pager
curl -s https://yuehua.online/api/health      # 期望 {"ok":true,"db":true,"redis":true,...}
sudo journalctl -u aiq-api -n 100 --no-pager
```

---

## 2. 红线

按危险程度排序。**违反前三条会造成不可逆的数据损失或全站故障。**

1. **绝对不要碰 `301_group` 数据库。** 那是同机另一个项目的库（23 张表）。
   本项目的库叫 **`aiq_course`**。任何 `mysqldump` / `DROP` / `DELETE` / `UPDATE`
   都必须显式带库名。不要写 `mysql -e "..."` 而漏掉库名——那会落到默认库上。

2. **改 nginx 配置前先备份，改完先 `nginx -t` 再 reload。**
   ```bash
   sudo cp /etc/nginx/sites-available/yuehua.online ~/yuehua.online.bak.$(date +%F-%H%M)
   sudo nginx -t && sudo systemctl reload nginx    # nginx -t 失败就什么都别做，先查
   ```

3. **不要删这些历史内容**（没确认过就一律不动）：
   - `/var/www/gaoshu`（本站域名更早以前的「高校数学」内容）
   - `/home/ubuntu/web/talk`（曾经挂在 7999 的演示站）
   - `/etc/nginx/sites-available/yuehua.online.bak-relay-20260810`

4. **端口 7999 不是空闲端口。** 它现在是 nginx 的一个下载服务，历史上被改过三次
   （演示站 → 下载服务 → …）。看到「7999 空着」这种结论先去看
   `/etc/nginx/sites-available/dl-7999` 再下判断。

5. **Redis 只清 `aiq:*`，永不 `FLUSHDB` / `FLUSHALL`。**
   本项目的限流键都在 db1 + `aiq:` 前缀下，是独占的。清它们的正确写法：
   ```bash
   sudo redis-cli -n 1 --scan --pattern 'aiq:*' | xargs -r sudo redis-cli -n 1 DEL
   ```
   （其他 db 和同 db 下的其他键可能属于别的项目。）

6. **`.env` 里的东西不要贴进任何输出**（SMTP 密码、数据库密码、`AUTH_SECRET`、
   `AI_IMAGE_API_KEY`、`AVATAR_MODERATION_API_KEY`）。
   要看键名可以：`sudo -u ubuntu grep -o '^[A-Z_]*=' /home/ubuntu/aiq-api/.env`

---

## 3. 待办

### 3.1 装数据库每日备份的 cron ← 唯一必须做的 —— ✅ 已于 2026-10-16 完成

**为什么**：`aiq_course` 里现在存的是真实用户的学习进度和作品。这些数据以前在浏览器
`localStorage` 里，丢了顶多一个人重做；现在集中在库里，**没有备份就是单点**。
库里还混着学生作品，属于丢了没法重建的东西。

**已安装的 crontab（追加在 agent-rpg 备份之后，原有条目没动）：**

```cron
12 4 * * * umask 077; /home/ubuntu/aiq-api/scripts/backup-db.sh >> /home/ubuntu/backups/aiq/backup.log 2>&1
25 4 * * * umask 077; sudo mysql aiq_course -e "DELETE FROM email_registration_codes WHERE expiresAt < UTC_TIMESTAMP() - INTERVAL 7 DAY" >> /home/ubuntu/backups/aiq/cleanup.log 2>&1
```

- 04:12 的备份避开了已有的 `30 3 * * *`（agent-rpg），两个 mysqldump 错开跑。
- 04:25 的清理只 `DELETE` 过期的注册验证码行，**显式带库名 `aiq_course`**，不碰别的。
- 两条都带 `umask 077`：cron 的默认 umask 是 022，而脚本内部的 `umask 077`
  是在建文件之后才生效的话就晚了——放在 cron 行上最稳。

**脚本 `scripts/backup-db.sh` 做的事**：`mysqldump --single-transaction`（不锁表）→
gzip → 写 `/home/ubuntu/backups/aiq/`。写入过程先落 `.part` 临时文件，**校验压缩包
完整且含 `CREATE TABLE`（恰好 5 张表）后才 `mv` 成正式文件**——cron/磁盘出问题时宁可
没有新备份，也不留下一个看起来正常的半截包。最后删 14 天前的旧备份。只碰 `aiq_course`。

**验证结果（2026-10-16 实跑）**：手动执行输出「备份完成」；产物权限 600、目录 700；
`zcat 最新备份 | grep -c 'CREATE TABLE'` = 5；目录里没有残留 `.part`。

**明天起确认 cron 真的触发**：`cat /home/ubuntu/backups/aiq/backup.log`，
以及 `ls -la /home/ubuntu/backups/aiq/` 里多出当天 04:12 的文件。

> 脚本以**服务器上的这份为唯一权威副本**。要改就在服务器上直接改，
> 改完照上面的验证重跑一次。

---

### 3.2 验证 nginx 的 API 兜底页 —— ✅ 已于 2026-10-16 完成（含一处配置修正）

**为什么**：`/etc/nginx/sites-available/yuehua.online` 的兜底目标不变——后端挂了时，
前端要拿到结构合法的 JSON 错误（能弹中文提示），而不是 nginx 的 HTML 错误页
（前端 `JSON.parse` 会炸）。

**修正内容**：原配置是 `proxy_intercept_errors on;`。验收时发现它有副作用——
intercept 不仅拦「nginx 自己生成的 502」（后端进程没起，这是我们想要的），
**连后端自己正常返回的 502/503 也会被掉包**：比如发验证码时 SMTP 失败返回的 502
（`MAIL_SEND_FAILED`）和 `/api/health` 探测到数据库挂掉时返回的 503
（带 `{ok:false,db:false}` 详情），全被换成通用的「服务暂时不可用」，具体原因丢失。

已改为 `proxy_intercept_errors off;`（nginx 默认值），`error_page` 保持不动：

```nginx
# 刻意 off（默认值）：intercept 开启时，**后端自己返回**的 502（如邮件
# 发送失败）和 503（如 health 探测到 DB 挂）也会被换成下面的通用文案，
# 具体错误信息丢失。关掉后两类场景各得其所：
#   · 后端进程没起来（连接被拒）→ 502 是 nginx 自己生成的，error_page 照样生效
#   · 后端正常返回 502/503      → 原样透传，客户端看到真实原因
proxy_intercept_errors off;
error_page 502 503 504 = @api_down;

location @api_down {
    default_type application/json;
    return 503 '{"error":{"code":"SERVICE_UNAVAILABLE","message":"服务暂时不可用，请稍后再试"}}';
}
```

改前已备份到 `/etc/nginx/sites-available/yuehua.online.bak-20261016-errpage`，
`nginx -t` 通过后 reload。

**验证结果（2026-10-16 实跑，停机约 5 秒）：**

| 步骤 | 结果 |
|---|---|
| `systemctl stop aiq-api` 后 `curl /api/health` | HTTP 503 + `application/json` + 那句中文 ✅ |
| 同窗口 `curl /`（静态站） | HTTP 200 ✅ 没跟着 API 一起挂 |
| `systemctl start aiq-api` 后 `curl /api/health` | `{"ok":true,"db":true,"redis":true,...}` ✅ |

**以后再动这段配置**：回到第 2 节第 2 条（先备份、`nginx -t`、再 reload），
并照上表三步重验。

---

### 3.3 清理旧前端目录（不急，观察几天再说）

`/var/www/yuehua.online.old-20261016-0027` 是发布前的那一版前端，留着是为了万一要回滚。

回滚方式（如果新版出问题）：
```bash
sudo mv /home/ubuntu/aiq-api/site /home/ubuntu/aiq-api/site.broken-$(date +%F-%H%M)
sudo mv /var/www/yuehua.online.old-20261016-0027 /home/ubuntu/aiq-api/site
```

另外 2026-10-16 合并操作前的快照在 `/var/www/yuehua.online.presymlink-2026-10-16-0039`
（内容与并入后的 `site` 一致，只是留个保险），确认稳定后可一并删除。

确认新版跑了一周没问题之后，这个目录可以删。**删之前先问，别自己决定。**

---

### 3.4 证书巡检

`yuehua.online` 的证书 **2026-12-28** 到期，`/etc/cron.d/certbot` 会在到期前自动续。
不用做任何事，但如果你在 12 月中旬以后接手，先确认一下：

```bash
sudo certbot renew --dry-run
```

---

## 4. 已知问题（**不是 bug，别去"修"**）

这几条是刻意的产品/技术决定，看到时不要当成缺陷：

1. **未登录完全不记录学习进度。** 不写内存、不写 `localStorage`。点「完成训练」
   会提示去登录。这是产品决定——记在一个刷新就没的地方，比不记更糟，
   用户会以为存下来了。

2. **忘记密码没有自助找回。** 本期不含重置流程，忘记了就是找不回来。
   要补的话最小做法是把邮箱验证的三段式复用一遍（`purpose: 'reset'` → proof → 改密 +
   `sessionVersion + 1` 踢掉所有端），大约半天工作量。

3. **作品署名强制为账号昵称。** 客户端传 `author` 会被服务端丢弃（已测）。
   展厅是公开的，允许自填作者名等于给冒名留门（"学校官方"随便写）。
   老师想署班级名，改自己昵称。

4. **跨标签页登录态不会自动刷新。** `ensureLoaded()` 只探活一次就置 `loaded = true`，
   在 A 标签页登录后，之前已经打开的 B 标签页不会感知到。刷新即正常。
   已知，未修。

5. **邮箱枚举**：`send-code` 对已注册邮箱返回 409，会暴露「这个邮箱注册过没有」。
   学校场景下 UX 优先（直接告诉家长"去登录"比"假装发了但一直收不到"好），
   风险接受。

6. **限流键在 Redis db1**。Redis 挂了会降级到进程内 Map，功能不中断
   （但多进程/重启后计数会重置）。

---

## 5. 怎么改动各层

### 前端（静态站）

前端**不在服务器上构建**。开发机构建后传产物。要更新：

```bash
# 开发机：npm run build 产出 site/
# 传到服务器 /tmp/site.tar.gz 后：
sudo rm -rf /home/ubuntu/aiq-api/site.new && sudo mkdir -p /home/ubuntu/aiq-api/site.new
sudo tar xzf /tmp/site.tar.gz -C /home/ubuntu/aiq-api/site.new
sudo chown -R www-data:www-data /home/ubuntu/aiq-api/site.new
sudo mv /home/ubuntu/aiq-api/site /home/ubuntu/aiq-api/site.old-$(date +%F-%H%M)
sudo mv /home/ubuntu/aiq-api/site.new /home/ubuntu/aiq-api/site
```

两次 `mv` 在同一文件系统上各自是原子操作，中间的空窗是亚毫秒级——
比「先删后解压」安全得多，后者有一个 index.html 指向不存在资源的真实窗口。

> 注意：`/var/www/yuehua.online` 只是软链（指向 `site`）。部署只动
> `/home/ubuntu/aiq-api/site`，不要对软链本身做 `mv`/`rm`，否则会拆散合并结构。
>
> ⚠️ **用户上传内容在 `site/uploads/`（作品插画 `works/` + 头像 `avatars/`），
> 不是构建产物。** 上面把 `site` 整个挪走的操作会连上传目录一起换掉。
> 部署前先把它移出 `site`，换完再移回：
>
> ```bash
> sudo mv /home/ubuntu/aiq-api/site/uploads /home/ubuntu/aiq-api/uploads-keep
> # ……执行上面的 site 替换……
> sudo mv /home/ubuntu/aiq-api/uploads-keep /home/ubuntu/aiq-api/site/uploads
> sudo chown -R ubuntu:www-data /home/ubuntu/aiq-api/site/uploads
> sudo chmod -R 775 /home/ubuntu/aiq-api/site/uploads
> ```
>
> 忘了移回时文件还在 `site.old-<时间戳>/uploads/` 里，可以捞回来；但页面在移回前
> 会全是裂图。

**提示词工坊与故事绘本的真实出图都是构建产物补丁，不在前端源码里。** 2026-10-18
新增的两个脚本把 `LabPlayView-*.js` 里的本地假图逻辑换成真实请求：
`patch-prompt-builder.mjs` → `/api/ai/image`；`patch-storybook.mjs` →
`/api/ai/storybook`（逐页提示词、每 4 页一批、失败页保留 SVG 占位、生成期间
按钮 loading 并显示逐页进度）。

**故事绘本页还整页替换成了独立的运行时创作台**（`scripts/storybook-studio.js`，
由 `install-storybook-studio.mjs` 装到 `site/assets/` 并在 `index.html` 挂独立
`<script type="module">`）。它不修改任何 chunk：启动后等 Vue app 挂载，用
`router.addRoute` 注册更高优先级的静态路由 `/lab/storybook`（原 `/lab/:id` 仍在，
直接打开该地址时会先离开再回来重新匹配），组件 `render()` 返回 null，在
`<main>` 里的占位注释节点前插入自己的 DOM。**模块启动失败会保留原页面，不会白屏。**

创作台是三段式：编排（五要素 + 成书预览）→ 生成（逐页进度）→ 审查（封面/跨页/
封底、翻页与拼接长卷、打印、逐项检查）→ 提交成果展厅。页头的三个步骤可以点击
互切：回编排、补画缺失/过期的插画、或直接进审查；生成中与提交成功后锁定。
描述改过而插画未重绘时会被标为过期，**不允许提交**；必须重绘或把描述改回原文。
换课文、删除有内容的页、重新生成全部插画都有二次确认。

重新部署新构建的前端会**覆盖这些补丁**，届时要：

1. 正解：把改动移植到开发机源码（两个组件的生成函数、等待动画与真实图渲染，
   以及创作台页面），重新构建；
2. 应急：构建产物传上来后依次重跑

   ```bash
   sudo node scripts/patch-prompt-builder.mjs
   sudo node scripts/patch-storybook.mjs
   sudo node scripts/patch-lazy-images.mjs   # 性能补丁（视图懒加载 + hero 预加载）
   sudo node scripts/install-storybook-studio.mjs  # 运行时创作台，放最后
   ```

补丁后的交互：等待时进度停在「上色与细化…」（不再循环），AI 返回后补完最后一步再
展示 4 张候选；缩略图与大图预览都显示真实出图，点缩略图切换大图。绘本训练入口
会进入新的创作台（旧 LabPlayView 里的 Storybook 组件仍保留作回退）。

**成果展厅也是独立的运行时替换**（`scripts/gallery-studio.js`，由
`install-gallery-studio.mjs` 安装）。它注册 `/gallery` 和新增的 `/gallery/:id`
两条路由，组件 `render()` 返回 null、在 `<main>` 的占位节点插入 DOM。启动时
**以地址栏 hash 为准**重新 `router.replace`：直接打开 `/gallery/<id>` 时初始导航
发生在新路由注册之前，用 `currentRoute` 判断会把深链接留成空白页。

列表按作品类型渲染不同封面母题（绘本 / 提示词 / 观察 / 地图 / MR / 发明 / 项目 /
伦理），卡片预览直接解析 `desc` 里的真实内容；作品带插画时封面、hero 与详情图集
一律用真实图片，**不拿装饰图标冒充插画**。详情页绘本阅读器按页序把 `images[i]`
对齐到第 i 页，没有插画的页才退回场景图标。

插画持久化在后端：`POST /api/works` 的 `images` 接受 https 或
`data:image/(png|jpeg|webp);base64`，服务端按 SSRF 规则下载（仅 https、443 端口、
DNS 解析拒绝内网、**连接固定在校验过的公网 IP 上**以防 DNS rebinding、不跟随
重定向、5MB/张、最多 20 张、魔数校验），落到
`site/uploads/works/<workId>-<序号>.<ext>`，数据库只存站内路径。删除作品时同步清理
磁盘文件。旧作品 `images IS NULL`，按文字排版展示。故事绘本创作台提交时会把逐页
插画一起带上，不再只传文字。

重新部署新构建的前端会覆盖这些运行时模块，重跑（都在新构建之后）：

```bash
sudo node scripts/install-storybook-studio.mjs
sudo node scripts/install-gallery-studio.mjs
sudo node scripts/install-me-studio.mjs   # 必须排在入口 bundle 之前（脚本会自动挪到位）
```

「我的」与个人作品是 `scripts/me-studio.js`（由 `install-me-studio.mjs` 安装），
同样在运行时注册 `/me`、`/me/works`。它**必须比入口 bundle 先加载**：入口路由的
catch-all 会把未知的 `/me` 重定向到 `/`，模块只在顶层能记到用户原始的深链接；
模块自身会轮询等 app 挂载，先加载不会抢跑。

作品语义：`POST /api/works` 默认 `published=false`（草稿），`GET /api/works`
只返回已发布且未隐藏的作品，`GET /api/works/mine` 才含草稿（仅本人）。
训练页的保存按钮与提示已统一为「保存到个人作品」；成果展厅的「发布我的作品」
从个人草稿里多选发布（`POST /api/works/:id/publish`），撤下
（`DELETE /api/works/:id/publish`）不清点赞，删除仍在 `/me/works`。
草稿详情只允许本人打开，页面显示「草稿 · 仅自己可见」并隐藏点赞。

头像链路：前端把所选图片读成 data URL，Canvas 裁成 512×512 JPEG（质量 0.86，
≤2MB）再上传；`POST /api/auth/avatar` 校验 data URL、体积与魔数后调用
`AVATAR_MODERATION_BASE_URL/API_KEY/MODEL`（OpenAI 兼容接口，默认
`deepseek-flash`，8 秒超时）做安全检查。明确违规返回 400 与原因；服务不可用
或超时按放行处理，不阻塞用户。文件落 `site/uploads/avatars/`，换头像或删除时
清理旧文件；**直接删用户行不会删头像文件**。

脚本把 `LabPlayView-*.js` 内容原地替换，并给**所有 chunk** 的 `./xxx.js` 引用和
`index.html` 入口统一追加 `?v=<内容哈希>` 绕开 `/assets/` 的 immutable 缓存。
**不要改成给入口/组件换新文件名**：入口 chunk 同时被十几个视图 chunk 静态引用
（共享依赖），换名会让浏览器同时拉起新旧两份 Vue 实例，整个 SPA 白屏。
补丁前会自动备份到 `site-prompt-builder-backup-<时间戳>/`，锚点不唯一则整体失败。

### 后端

```bash
cd /home/ubuntu/aiq-api
# 传新的 src/ 上去之后：
sudo systemctl restart aiq-api
sleep 3 && curl -s https://yuehua.online/api/health
```

**注意**：数据库结构目前用 `prisma db push` 同步（无迁移历史）。
`db push` 在需要删列时会**静默丢数据**。现在库里已经有真实用户数据了，
**再改 schema 必须先 `mysqldump` 备份，并考虑改用 `prisma migrate`。**

### 数据库

```bash
sudo mysql aiq_course                      # 进去看
sudo mysql -N -B aiq_course -e "SHOW TABLES;"
```

5 张表：`users` / `email_registration_codes` / `lab_progress` / `works` / `work_likes`。
外键三层级联：删 `users` 一行会连带删掉它的进度、作品和点赞。

`works.images`（`TEXT NULL`，2026-10-19 新增）存站内路径的 JSON 数组，例如
`["/uploads/works/cm...-0.png"]`。`users.avatarUrl`（`VARCHAR(200) NULL`，
2026-10-19 新增）存头像站内路径。磁盘对应 `site/uploads/works/` 与
`site/uploads/avatars/`，目录属主 `ubuntu:www-data`、权限 775
（API 进程写、nginx 读）。**直接删数据库行不会删文件**：正常删除作品走
`DELETE /api/works/:id`、删除头像走 `DELETE /api/auth/avatar`，会同时清理磁盘；
手工清库后记得把该 workId / userId 前缀的文件一起删掉。

### 应用日志

```bash
sudo journalctl -u aiq-api -f                    # 实时
sudo journalctl -u aiq-api --since '1 hour ago'  # 最近一小时
```
业务错误（含 4xx）用 `info` 级别记录，未预期的异常用 `error`。
找 500 就 `journalctl -u aiq-api | grep '未处理的服务端异常'`。

---

## 6. 开发机侧（不用你管，列出来是为了让你知道有些东西不在服务器上）

- **前端源码在开发机**。服务器上只有构建产物 `site/`（静态文件），不在服务器上
  构建、也没有前端源码——`README.md` 里的目录树画的是开发机仓库全貌。
- 一次性的诊断脚本（`probe-tz.mjs` / `probe-server.mjs` / `probe-net.mjs`）已删除。
- **真实浏览器验收**（`scripts/cdp-e2e-auth.mjs`，注册→刷新→退出→再登录）需要
  Windows + Edge + `ssh.exe`，在开发机上对线上跑，**服务器上跑不了**。

**服务器 `scripts/` 目录里实际有这些**（跑验收时别以为少了文件）：

| 文件 | 用途 | 能在服务器上跑吗 |
|---|---|---|
| `backup-db.sh` | 每日备份（cron 调用，见 3.1） | ✅ 就是给这台机器用的 |
| `smoke-auth.mjs` | API 冒烟：注册/登录/会话/限流/防枚举，33 项 | ✅ `node scripts/smoke-auth.mjs` |
| `smoke-progress.mjs` | API 冒烟：进度合并/并发/导入/清空，37 项 | ✅ `node scripts/smoke-progress.mjs` |
| `lib/kit.mjs` | 上面两个共用的工具（含删账号护栏） | 被引用 |
| `patch-prompt-builder.mjs` | 给前端构建产物打「真实出图」补丁（见 §5，需 sudo） | ✅ `sudo node scripts/patch-prompt-builder.mjs` |
| `patch-storybook.mjs` | 给前端构建产物打「故事绘本真实插画」补丁（见 §5，需 sudo） | ✅ `sudo node scripts/patch-storybook.mjs` |
| `storybook-studio.js` | 故事绘本创作台源码（运行时替换整页，见 §5） | 被安装脚本引用 |
| `install-storybook-studio.mjs` | 把创作台装进 `site/assets/` 并挂到 `index.html`（见 §5，需 sudo） | ✅ `sudo node scripts/install-storybook-studio.mjs` |
| `gallery-studio.js` | 成果展厅运行时替换源码（列表/详情/插画展示，见 §5） | 被安装脚本引用 |
| `install-gallery-studio.mjs` | 把展厅模块装进 `site/assets/` 并挂到 `index.html`（需 sudo） | ✅ `sudo node scripts/install-gallery-studio.mjs` |
| `gallery-e2e.mjs` | 展厅浏览器验收 83 项：图片落盘/SSRF/分类型展示/深链接/点赞/个人作品挑选发布/撤下/删除清理 | ✅ `node scripts/gallery-e2e.mjs`（无头 Chromium 在本机跑） |
| `me-studio.js` | 「我的」与个人作品页运行时模块源码（见 §5） | 被安装脚本引用 |
| `install-me-studio.mjs` | 把「我的」模块装进 `site/assets/` 并挂到 `index.html`（需 sudo；必须排在入口前） | ✅ `sudo node scripts/install-me-studio.mjs` |
| `me-e2e.mjs` | 我的页面验收 63 项：头像下拉入口、移动端抽屉、草稿/发布语义、头像上传替换删除、裁剪上传、改密码旧会话失效、游客守卫 | ✅ `node scripts/me-e2e.mjs`（无头 Chromium 在本机跑） |
| `lib/cdp-kit.mjs` | 上面验收脚本用的极简 CDP 驱动（支持 `E2E_BROWSER_FLAGS` 追加 Chromium 参数） | 被引用 |
| `cdp-e2e-auth.mjs` | 真实浏览器验收 | ❌ 留作参考，跑不了 |

两个 smoke 默认打 `http://127.0.0.1:3020`，用 `sudo mysql` / `redis-cli` 本地交叉
验证，跑完自动删测试账号（`SMOKE_EMAIL` 可换，默认 `301@301.group`；
`SMOKE_KEEP=1` 保留）。删账号带护栏：**昵称不是脚本自己的测试昵称时拒绝删**，
退出码 1，此时别急着 `SMOKE_FORCE=1`，先看清楚对方是谁。

---

## 7. 需要人来做的（agent 做不了）

**QQ 邮箱收信实测。** 注册流程依赖阿里云企业邮发验证码，计划里明确要求
「必须实测 QQ 邮箱收信不进垃圾箱」——中文内容 + 新域名发信，进垃圾箱的概率不低。

做法：用一个 QQ 邮箱在 https://yuehua.online/#/register 走一遍注册，
看验证码邮件落在收件箱还是垃圾箱。

- 落在收件箱 → 没事
- 落在垃圾箱 → 需要在阿里云企业邮后台检查发信域名的 SPF/DKIM 配置，
  并考虑给邮件内容加热链接/退订说明

这条**必须由有邮箱访问权的人做**，agent 只能发信、看不到收件箱。
