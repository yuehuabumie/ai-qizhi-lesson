# 前端设计与全站移动适配验收（2026-10-20）

> 本文保留第一轮 18:27 发布的验收证据。之后的排版与组件修复于 20:45:08 完成最终更新，当前模块版本及其复核见 [组件复查记录](COMPONENT-REVIEW-2026-10-20.md)。

**状态：前端调整、部署和生产复核已完成。** 本轮于 2026-10-20 18:27:23（Asia/Shanghai）部署，生产全站 544/544、窄屏 56/56 通过。本记录区分生产和预览结果，保留真机及其他尚未验收的范围。

## 范围与验收环境

范围包括首页、关于、课程体系、四个课程详情页、训练列表与全部 13 个训练入口、课堂教学、资源、视频、展厅、个人页面/作品、登录/注册、教师班级/作业、三类学生作业页面。全站套件覆盖 27 个主路由（含全部 13 个训练入口），另检查登录/注册和班级/作业的动态状态。检查明暗主题、导航抽屉、表单、弹窗、固定学生操作条、错误状态与主要键盘交互。

固定视口为 `1366×768`、`1024×768`、`844×390`（手机横屏）、`768×1024`（平板）和 `390×844`（手机竖屏），每个视口检查浅色和深色；另对 `320px`、`375px` 窄屏抽查。

- 浏览器：**Chromium 153.0.8010.12**；运行环境为 **Ubuntu / Node.js 22**。
- 本轮 UI 预览目标：`https://127.0.0.1:3320`，只监听回环地址；静态模块由预览服务覆盖，API 连接本机 `127.0.0.1:3020`。
- 原始运行证据根目录：`/tmp/aiq-codex-20261020/`。永久归档位置为 `/home/ubuntu/aiq-api/validation/ui-20261020/evidence.zip` 与同目录 `summary.json`；仓库结果摘要见 [summary.json](ui-20261020/summary.json)。详细预览报告路径见下文，临时目录清理后应从永久归档读取。
- 已人工查看的代表截图：课程详情 320px、390px 深色，资源页 375px，博物馆训练 390px，登录页 390px，导航抽屉 844×390 等。
- 代码分支：`codex/mobile-responsive-20261020`（基于 `5ea0d92`）；本轮静态文件 SHA-256 清单见 [module-hashes.json](ui-20261020/module-hashes.json)。
- 线上验收目标：`https://yuehua.online`；生产全站、窄屏复核及资源/哈希核对均已通过。

## 本轮调整记录

代表截图保存在本仓库：[课程 320px](ui-20261020/course-320.png)、[课程深色 390px](ui-20261020/course-390-dark.png)、[资源 375px](ui-20261020/resources-375.png)、[博物馆 390px](ui-20261020/museum-390.png)。

已实施并在本轮预览中检查：

- 课程详情网格允许正确收缩，面包屑与长文本可换行，手机底部操作按钮分行，修复窄屏撑宽页面；资源页改为两列统计与适合手机的筛选布局。
- 主要手机按钮、单选/复选选项及输入包装控件扩大至至少 44px；手机文本表单采用 16px 字号，补充导航菜单可访问名称与状态。
- 博物馆训练的 70 格地图在手机上保留至少 44×44px 格子，仅地图面板横向滚动，并添加行列位置标签及滚动提示；整页保持设备宽度。
- 运行时模块暗色规则改为匹配真实 `html.dark`，调整强调色、错误/成功状态及边框等，明暗主题均参与截图和布局测量。
- 班级弹窗补充可访问名称、焦点循环、背景 inert、滚动锁定和关闭/保存重绘后的焦点归还；旧预览请求失败不能关闭后打开的新弹窗。
- 学生操作条通过 `ResizeObserver` 按实际高度及底部偏移动态留白；长姓名、长标题和标签可换行。监考条留白按“操作条高度 + 底部偏移 + 12px”重算，离开时释放观察器和占位。
- 绘本通用确认弹窗补充背景 inert、锁定背景滚动、反向 Tab 循环，以及 Escape 关闭后的焦点恢复。
- 审计工具使用请求的视口宽度识别溢出及移动自动缩小，检查弹窗/操作条边界、动态底部占位和手机文本字号；失败返回非零退出码。补充测量逻辑回归检查、窄屏与动态页面细节套件。

## 可复跑命令

命令在服务器项目根目录 `/home/ubuntu/aiq-api` 执行。API 默认 `http://127.0.0.1:3020`，浏览器默认 `https://yuehua.online`；不要用 `https://127.0.0.1` 代替站点主机名，避免命中其他 nginx 虚拟主机。

无需浏览器的检查：

```bash
npm run typecheck
node --test scripts/responsive-metrics.test.mjs scripts/lab-callbacks.test.mjs
```

班级作业 API 验收：

```bash
node scripts/assign-e2e.mjs
```

班级作业浏览器验收：

```bash
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/assign-ui-e2e.mjs
```

全站五视口、双主题审计：

```bash
AUDIT_WHOLE_SITE=1 AUDIT_OUTPUT=/tmp/aiq-responsive-final \
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/responsive-audit.mjs
```

320×740 与 375×812 窄屏抽查，覆盖 14 个公开页面/入口的双主题，共 56 个布局测量结果。该套件不注册账号、不发送邮件，也不写业务数据：

```bash
AUDIT_OUTPUT=/tmp/aiq-public-mobile-final \
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/public-mobile-audit.mjs
```

长内容、百人名单、作品弹窗和错误恢复细节验收。使用前述五个固定视口并增加 320×740，逐状态测量双主题；错误恢复检查使用 390×844：

```bash
AUDIT_OUTPUT=/tmp/aiq-mobile-detail-final \
E2E_BASE=https://yuehua.online \
E2E_BROWSER_FLAGS_JSON='["--host-resolver-rules=MAP yuehua.online 127.0.0.1"]' \
  node scripts/mobile-detail-audit.mjs
```

运行时模块可在只监听回环地址的 `scripts/preview-site.mjs` 中先验证；通过 `PREVIEW_SITE` 指向现有静态目录，并提供 `PREVIEW_TLS_KEY`、`PREVIEW_TLS_CERT` 启用 HTTPS。验收预览时将 `E2E_BASE` 改为实际 HTTPS 预览地址；自签名证书只在该本机预览中使用 `--ignore-certificate-errors`。预览 API 仍连接指定后端，不能把它当成隔离数据库。

本轮预览执行时使用 `E2E_BASE=https://127.0.0.1:3320` 与 `E2E_BROWSER_FLAGS_JSON='["--ignore-certificate-errors"]'`。生产域名命令中保留 host resolver；独立预览不需要该域名映射。

测试数据要求：套件会真实发送验证码邮件，依赖服务器本机 MySQL/Redis 与 Chromium。使用专用测试邮箱并串行运行；保留昵称删除护栏，不绕过 `SMOKE_FORCE`。学生核名每 IP 限流 30 次/10 分钟，连续套件需等待冷却或只清精确对应的测试键；不得使用 FLUSH、清整个前缀或操作其他库。

## 已取得的验证结果

- TypeScript：**通过**，`npm run typecheck`。
- Node 检查：**4/4 通过**，包含 3 个响应式测量回归检查和 1 个练习回调标识一致性检查。
- 班级作业 API：**45/45 通过**，日志 `/tmp/aiq-codex-api.log`。
- 扩展班级作业 UI（预览）：**43/43 通过**，日志 `/tmp/aiq-codex-extended-ui.log`。实际走通真实插画生成、审查确认、提交、教师预览、发布展厅和撤下；包含空姓名/姓名不匹配、关闭与失效链接的提示。
- 全站五视口 × 双主题（生产）：**544/544 通过**，其中 **506 个布局/主题测量结果 + 38 个交互断言**，包含新增的 9 个训练选项触控范围断言；结果与原始证据收录于永久归档。544 是检查结果数，不能称为不同页面数。
- 320/375px 窄屏（生产）：**56/56 通过**，结果与截图收录于永久归档。
- 全站五视口 × 双主题（预览）：**535/535 通过**，其中 **506 个布局/主题测量结果 + 29 个交互断言**；报告 `/tmp/aiq-codex-20261020/whole-final/report.json`。535 是检查结果数，不能称为 535 个不同页面。
- 320/375px 窄屏（预览）：**56/56 通过**，报告 `/tmp/aiq-codex-20261020/narrow-final/report.json`。
- 动态页面细节（预览）：**99/99 通过**，报告 `/tmp/aiq-codex-20261020/details-confirmed/report.json`。

上述全站报告包含学生操作条视口边界、按钮至少 44px 与底部占位检查，导航抽屉的高度和导航后关闭，以及班级弹窗焦点循环、关闭/保存后恢复焦点和背景隔离。每条测量的实际几何数据和截图见对应报告目录。

390×844 实测学生操作条为 366×108px，左侧 12px、底部 10px；两个按钮分别为 82×44px、84×44px，页面底部留白 130px，与实际操作条高度和偏移匹配。数据见仓库 [summary.json](ui-20261020/summary.json)。

细节套件额外覆盖：

- 100 人名单、29 字姓名、长班名、120 字限制以内的长作业标题，以及连续英文标题/说明；检查详情、名单和作业表格的布局。
- 六个视口中的私有作品详情、展厅个人作品挑选弹窗、个人作品新建弹窗，均测量浅色与深色。
- 浏览器拦截请求模拟断网后，页面显示重试入口；恢复网络后可加载完整名单。
- 浏览器模拟一次提交 HTTP 503，保留学生文字和照片并恢复可提交状态；第二次通过真实接口成功提交并展示文字/照片。
- 旧提交预览请求失败不关闭新打开的弹窗，新请求完成后正常显示内容。
- 学生确认弹窗锁定背景、反向 Tab 循环，Escape 关闭后恢复背景和触发按钮焦点。

这些故障场景通过浏览器阻断/拦截模拟，不需要关闭生产服务，也不等同于真实后端超时测试。

## 部署与线上复核

静态模块已于 **2026-10-20 18:27:23（Asia/Shanghai）** 完成最后更新，随后生产全站和窄屏复核均通过；API 服务保持运行。

部署只更新前端模块与静态入口，安装输出和线上 HTML 的版本参数一致：`class-studio.js?v=zocjnIv2`、`storybook-studio.js?v=g4FAWhz7`、`responsive-shell.js?v=5EGv9JH6`。三份源文件与线上 assets 副本逐字节一致；三个模块和 `site/index.html` 共四项 SHA-256 均与仓库清单一致。`/api/health` 的 API、MySQL、Redis 状态全部为 true，`aiq-api.service` 为 active；本轮专用测试邮箱对应账号已清理，`users` 计数为 0。

部署前备份：`/home/ubuntu/aiq-api/.backups/ui-20261020/before.tgz`，另有原脚本副本 `files/`。回滚可将该归档解回 `/home/ubuntu/aiq-api`，恢复匹配的旧模块与 `site/index.html`；新增的 responsive-shell 文件不再被旧入口引用。保留上传目录，未重启后端或修改 nginx、数据库结构。

新增 9 个训练选项触控范围断言后，生产全站复核实测 **544/544 通过**，生产窄屏 **56/56 通过**。此前 **535/535** 对应预览版的 506 个布局/主题测量结果和 29 个交互断言，作为过程记录保留，与最终生产结果分开。

三份最终模块的 SHA-256（完整清单含静态入口见 [module-hashes.json](ui-20261020/module-hashes.json)）：

- `class-studio.js`：`ce87239c8bf62e6f9c75196d118b846f3dd7761433a4f236a88558f2169d4749`。
- `storybook-studio.js`：`8381405a1cfb1b39ae50519a47622b99d9c4ea2721067afd509b3de363b38fcb`。
- `responsive-shell.js`：`e441aff491fa9ad9d43c6b54007f378385b9460197bc107e71e51d831455aaf4`。

永久证据已归档至 `/home/ubuntu/aiq-api/validation/ui-20261020/evidence.zip`（约 565KB），机器可读结果为同目录 `summary.json`；摘要已下载至仓库 [docs/ui-20261020/summary.json](ui-20261020/summary.json)。静态入口、模块版本、源文件/线上副本一致性、健康状态和测试账号清理均已核实。

## 结果解读与尚需实测

`markLab` 静态检查只能证明回调标识存在且与作业目录一致，不能证明 12 个训练都已从开始到结束人工完成。响应式测量将请求的视口作为溢出基准，避免移动浏览器自动缩小造成假通过；元素边界检查仍不能取代截图和交互检查。触控目标需要考虑有效包装元素和局部画布等场景，不以隐藏原生输入框尺寸直接判定结果。

**尚未完成 iOS Safari / Android 真机验证。** 真实软键盘遮挡、输入自动缩放、刘海/底部安全区、横竖屏旋转、地址栏收缩和触控惯性滚动需在真机确认。Chromium CDP 的模拟结果不应表述为全设备兼容或完整无障碍认证。

仍未完成的验收范围：

- 12 个互动练习逐个从开始到结束完整通关；目前回调标识检查与工作台布局检查已完成，不能扩展为游戏全流程结论。
- 真实接口超时、切入后台标签页及恢复后的行为。已覆盖浏览器模拟的断网和单次提交 503，不能代替这些场景。
- 注册验证码错误的 UI、重复姓名/超过名单容量的教师操作 UI。百人名单的布局已测，不代表这些错误流程已测。
- 完整无障碍审计，包括屏幕阅读器、所有页面的键盘路径及系统化对比度测量；已补充的焦点管理与状态色不构成完整认证。

相关依据：[上一轮未完成清单](../HANDOFF-GPT-2026-10-20.md)、[运维红线与部署背景](../HANDOFF.md)、[当前仓库运行说明](../README.md)。
