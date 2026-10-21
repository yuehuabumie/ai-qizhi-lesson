# 智能备课运行器

这里接入固定版本 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.2`，使用 DSH 的真实 agent 循环、工具、压缩、持久会话和子任务。网站沿用原账号；不开放 DSH 原版单用户 Web 服务。模型为 DeepSeek 官方 `deepseek-flash`。

## 部署结构

网站服务器保存账号、私有附件、历史、队列和业务确认。另一台 Linux Docker 服务器运行本目录的可信 broker，每个任务创建独立容器。两端通过受限 SSH 转发通信：网站 `127.0.0.1:3331` → worker `127.0.0.1:3330`；worker `127.0.0.1:3332` → 网站 `127.0.0.1:3020`。测试环境把最后一个端口换成 3021。

worker 的 `3330` 只监听 loopback 和内部 bridge，`3333` 只监听内部 bridge。不要通过 nginx 或公网暴露这两个端口。

容器以 uid 1000 运行，系统文件只读、全部 capabilities 移除、禁止提权、无 Docker socket。仅挂载本次对话原件目录且只读；`/state`、`/work`、`/tmp` 使用有大小限制的 tmpfs。`/tmp` 允许执行，因为 DSH 原生模块加载器需要在临时目录加载共享库。初始每任务 1GiB 内存、1.5 CPU、128 PID；并发为 1。

内部 Docker 网络禁止直连互联网；联网走 broker 的 HTTP(S) 代理，仅允许公共 IPv4 的 80/443，校验 DNS 并固定连接 IP，拒绝 loopback、内网、元数据和 IPv6。代理只接受当前活动容器，限制每任务请求数与总字节。INPUT 链仅对本项目 `aiqprep0` 生效，允许 broker/proxy，拒绝其他宿主端口。

DeepSeek Key 和共享服务凭据只留在可信宿主进程。容器拿到的只有本次任务凭据。模型访问、上传到模型提供方的图片、教学工具和文件交付都受任务及对话归属校验。模型提供方的全账户文件列表不会直接返回给某位教师。

每任务模型调用默认最多100次，`PREP_MAX_MODEL_CALLS`可配置为1到500的整数。达到上限会记录明确错误并保留该错误原因，不会被容器退出码覆盖；复杂多文件任务可按实际成本调整。

## 安装与配置

1. 网站备份数据库与代码后，按顺序执行 `prisma/migrations/202610210001_teaching_agent/migration.sql`、`202610210002_prep_agent/migration.sql`。这些是对既有数据库的一次性增量 SQL，不能重复执行；失败重试前检查实际表结构。不要在生产库使用 `db push`。
2. 网站 `npm ci --ignore-scripts`，然后 `npm run db:generate`、`npm run typecheck`。将 `.env.example` 的 `PREP_*` 配置合并到私有环境文件，不覆盖原有数据库和出图配置。
3. 将本目录放到 worker `/opt/aiq-prep`，创建 root:root 0700 的 `/etc/aiq-prep`、`/var/lib/aiq-prep`。按两个 example 创建 `runtime.env`、`broker.env`，权限均为 0600；共享凭据与网站相同。Key 用编辑器在服务器填写，不粘贴到聊天、Git 或终端历史。
4. `docker build -t aiq-prep:1 .`。若 Docker Hub 在所在网络不可达，可指定官方 Node 镜像缓存 `--build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim`；Debian 软件源可选 `--build-arg DEBIAN_MIRROR=mirrors.cloud.tencent.com`，仍由 Debian 签名校验软件包。
5. 网站端配置专用 SSH Key，worker 的 authorized_keys 使用 `restrict,command="/usr/sbin/nologin",port-forwarding,permitopen="127.0.0.1:3330",permitlisten="127.0.0.1:3332"`。核对 worker 主机公钥后写 known_hosts，不关闭主机校验。服务模板见 `aiq-prep-tunnel.service`，按实际主机调整。
6. 安装 `aiq-prep.service`，`systemctl daemon-reload` 后启动。它只创建本项目网络和链，不修改已有 Docker 网络、网站或其他项目。网络名/网段冲突时先调整脚本和 broker 配置。
7. 执行前端三个 installer：`install-class-studio.mjs`、`install-storybook-studio.mjs`、`install-prep-studio.mjs`。网站环境启用 `PREP_ENABLED=true`，重启 API。页面 `/api/prep/status` 必须报告真实就绪状态；未配置模型 Key 时页面禁用发送。

worker broker 使用 Node 20+ 的内置 API；执行镜像使用 Node 24。主项目继续按原服务的 Node 版本运行。

## 两服务器链路的 BBR 持久化（可选）

跨区丢包时，同一条 SSH 连接传输大附件会影响事件轮询。`setup-peer-route.py`只为明确的对端公网IP增加main表`/32`路由并设置`congctl lock bbr`，自动从`ip -j -4 route get`取得网关、网卡和源地址。它不修改默认路由、全局sysctl或其他目的地址；只允许本项目的`43.131.233.40`和`82.156.157.199`。

在两台宿主分别安装（从本目录执行）：

```sh
sudo install -d -o root -g root -m 0755 /usr/local/lib/aiq-prep
sudo install -o root -g root -m 0755 setup-peer-route.py /usr/local/lib/aiq-prep/setup-peer-route.py
sudo install -o root -g root -m 0644 aiq-prep-peer-route.service /etc/systemd/system/aiq-prep-peer-route.service
sudo install -d -o root -g root -m 0700 /etc/aiq-prep
sudoedit /etc/aiq-prep/peer.env
sudo chown root:root /etc/aiq-prep/peer.env
sudo chmod 0600 /etc/aiq-prep/peer.env
sudo systemctl daemon-reload
sudo systemctl enable --now aiq-prep-peer-route.service
```

网站服务器`43.131.233.40`的`peer.env`仅写`PREP_PEER_IP=82.156.157.199`；worker `82.156.157.199`仅写`PREP_PEER_IP=43.131.233.40`。unit在`network-online.target`之后、tunnel和broker之前运行；两者不以此优化服务成功为启动前提。若内核缺BBR，脚本尝试`modprobe tcp_bbr`，仍不可用则明确记录fallback并成功退出，继续使用原路由。仅在网站服务器重启`aiq-prep-tunnel.service`，使新SSH连接采用新算法；不会自动重启业务服务或任务。

已存在且出口、源地址及锁定BBR均一致的精确路由会被登记接管，包括本次临时添加的两条路由；其他精确路由、多路径或非main表路由会被拒绝，绝不执行`replace`或`flush`。管理记录在root专有的`/var/lib/aiq-prep-peer-route`中；多次执行幂等，重启后按当前出口重新创建。可用以下命令只读核对（worker将IP换为`43.131.233.40`）：

```sh
sudo env PREP_PEER_IP=82.156.157.199 /usr/bin/python3 /usr/local/lib/aiq-prep/setup-peer-route.py status
ip -4 route show table main exact 82.156.157.199/32
sudo journalctl -u aiq-prep-peer-route.service -n 30 --no-pager
```

移除时，在两端执行`sudo systemctl disable --now aiq-prep-peer-route.service`。`ExecStop`只删除管理记录与当前完整路由仍一致、且仍锁定BBR的那一条`/32`路由；如已被其他管理员修改，会报错并保留，不删除管理记录，需先核对。没有记录时不会删除任何路由。确认移除后可删除本unit、该脚本和`peer.env`，再`sudo systemctl daemon-reload`；不要删除整个`/etc/aiq-prep`。网站端再次重启tunnel即可让新连接恢复原有选路及拥塞算法；不会卸载共享的BBR内核模块。

## 持久化与业务确认

浏览器关闭不终止任务。数据库队列由网站服务消费；同一账号同时仅一个活动任务。网站重启后继续查询同一 runId；worker 不重复启动已知任务。worker 异常重启会清理它自己记录的遗留容器并把受影响任务标记失败，避免悄悄重放业务。

成功任务关闭 DSH 后，将容器内的对话和工作目录压缩成私有归档；归档只在下次容器内解压。宿主不解压模型控制的 tar，也不把可写宿主目录暴露给模型。停止或强制失败时保留上一次成功归档，再从当前会话的缺失文本恢复背景，不自动重新执行旧指令。单归档最多 128MiB，归档加运行日志初始总额度 2GiB，并保留至少 8GiB 空闲盘。

创建班级、编辑名单、保存分组、创建/发布作业和公布反馈必须经过网站登录用户的预览确认。提案绑定版本和工具调用编号，确认与取消用同一任务行锁；运行器不能确认自己的提案。已确认的业务写入无法靠停止模型撤销；正在执行时先等待完成。

网站记录额度与文件额度分开控制；达到上限会拒绝新任务，要求删除不用的对话。删除对话同时清理本地附件、远端归档、日志及该对话已上传到模型 Files API 的图片；远端清理失败不会假称删除成功。

## Skills、MCP 与成果

教师只能维护自己账号的 Skill 文本；每次任务复制到当前容器的 `.agents/skills`，不授予宿主权限。关闭`tool-plugin-manager`不影响独立的Skill目录和`skill`工具。SDK默认保留`todo_write`及spawn/fork子Agent。计划可用待办和自然语言表达；原版交互式Plan模式审批尚未开放。

管理员MCP仅通过可信broker代理远程Streamable HTTP服务，默认空配置。将`PREP_MCP_CONFIG`设置为宿主上的私有JSON文件，例如`/etc/aiq-prep/mcp.json`（root:root，0600）：

```json
{
  "servers": [
    {
      "name": "teaching_search",
      "url": "https://approved-mcp.example/mcp",
      "headers": { "Authorization": "Bearer replace-with-mcp-service-token" }
    }
  ]
}
```

最多8个固定服务，名称仅含字母、数字、下划线或连字符且最长32字符。远程地址必须是HTTPS；loopback HTTP仅供宿主本地服务和离线验收。管理员负责审核该服务公开的工具和数据权限；认证头只由broker注入，沙箱输入的Authorization及任意其他请求头不会透传。代理禁止HTTP重定向，保留必要的MCP协议头，按每个任务隔离虚拟会话编号；响应不透传认证头、Cookie、Location或真实MCP会话编号，并遮盖已知配置凭据。停止任务会中止代理请求并尽力结束其远端MCP会话。

容器只收到服务名称与本任务broker地址，runner生成的MCP patch仅含短期任务凭据，远端地址和共享认证配置不进入容器。每任务MCP请求最多250次，单请求1MiB、单响应8MiB、累计流量64MiB。MCP请求最长120秒；长连接会按客户端协议重新连接。暂不支持管理员配置stdio MCP进程。

旧`PREP_ADMIN_PATCH`已停用，若仍设置broker会拒绝启动。请删除该变量并迁移配置，不能再把含共享凭据的patch挂载到教师沙箱。

容器预装 Python、LibreOffice、Poppler、中文字体、Tesseract、Chromium，以及 Word/Excel/PPT/PDF/图片所需 Python 库。老版 Office 可用 LibreOffice 转换。模型须实际读取原件；模糊和手写数据需要教师核对，不保证每个文件都能识别。

交付仅接受 `/work/output` 中的普通文件；逐级目录描述符检查，拒绝符号链接及目录外路径。可信 broker 把实际字节上传到网站私有附件 API，老师登录后下载。教学配图通过网站原有出图服务生成，真实 Key 同样不会进入容器。

## 验证

- `npm test`（本目录）：公网目标与代理边界、真实 SSE 分帧、容器参数、模型 Files API 会话隔离、MCP真实HTTP会话/凭据/流量隔离与现代/旧版客户端协商、模型调用限额。
- 主项目 `node --import tsx --test scripts/teaching-rules.test.mjs`。
- 隔离数据库/API：`scripts/teaching-api-e2e.mjs`；`scripts/prep-api-e2e.mjs` 内嵌 fake worker，固定监听 localhost:3334。不得把 fake worker 指向生产服务。
- 浏览器：`prep-components-e2e.mjs`、`teaching-components-e2e.mjs`、`prep-navigation-e2e.mjs`，可用 `E2E_BROWSER` 指定 Chromium/Edge。
- 真实镜像离线验收：挂载 `tests/smoke-sdk.mjs`、`tests/smoke-tools.mjs` 到 `/app` 执行；使用与生产相同限制、`--network none`，后者的 loopback 模型响应是固定测试数据，不能算真实模型验收。
- MCP镜像离线验收：将`tests/smoke-mcp.mjs`与宿主的`mcp-proxy.mjs`分别只读挂载为`/app/smoke-mcp.mjs`、`/app/mcp-proxy.mjs`，同样以`--network none`和可执行`/tmp`运行`node /app/smoke-mcp.mjs`。它验证真实DSH插件发现/调用、代理凭据遮盖和会话清理；模型与MCP返回均为固定loopback测试数据。
- Linux broker 隔离回归：`tests/broker-e2e.mjs` 使用自己创建的测试镜像、数据目录及 fake core。运行前停止本项目的空闲 broker，完成后恢复；不操作原站数据。

真实调用和发布验收记录见 `../docs/SMART-PREP-VERIFICATION-2026-10-21.md`，其中明确区分固定模型测试、官方真实调用、实际渲染和生产检查。新增文件格式或外部 MCP 时仍须用合成资料单独验收。
