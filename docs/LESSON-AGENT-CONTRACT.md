# 智能备课实现接口约定

业务范围以 `LESSON-AGENT-REQUIREMENTS-2026-10-20.md` 为准。模型官方 deepseek-flash；账号统一 key；同对话持久恢复、新对话隔离；先预览确认业务写入；关页继续任务；无定时任务；教师上传 Skills、管理员配 MCP；试卷单选/判断、只提交一次，成绩和答案由教师分别公布。

## 教学 API（在现有 /api/classes 与 /api/assign 下扩展）

- 成员 DTO 扩展 `studentNo?:string|null, gender?:string|null, score?:number|null`，姓名必填，其余可空；保留旧 names:string[] 导入兼容，新 members:[{name,studentNo?,gender?,score?}]。
- `POST /classes/:id/members/batch`：`{operations:[{action:'add'|'update'|'delete',id?,name?,studentNo?,gender?,score?}]}`；原子应用，沿用删除保护。
- `GET /classes/:id/groups` → `{groups:[{id,name,members:[{id,name,studentNo,gender,score}]}]}`。
- `PUT /classes/:id/groups`：`{groups:[{name,memberIds:string[]}]}`；班级成员必须恰好分组一次，保存替换分组，不改个人提交。
- 创建作业扩展 type=`quiz`、status=`draft|open|closed`（旧请求默认 open）。`quiz:{questions:[{id,type:'single'|'boolean',stem,options:string[],answer:number,points:number,explanation:string}]}`。判断题 options 固定为 ['正确','错误']，answer 为 0 或 1。题目 id 必须稳定。
- `PATCH /classes/:id/assignments/:aid` 可设置 `{status:'open'|'closed',scoresPublished?:boolean,answersPublished?:boolean}`；教师明确公布后学生才获准读取。
- 学生 `POST /assign/:token/verify` 扩展 studentNo 可选；有同名时要求学号区分。
- 学生作业元信息与 /session 返回 quiz 题目，未公布时不含 answer/explanation/score；`POST /assign/:token/submit` 的 quiz body=`{kind:'quiz',answers:[{questionId,answer:number}]}`；服务端计分与原子只提交一次；提交后不允许改写。
- 试卷不允许发布到成果展厅，避免答案/学生数据泄露。

## 智能备课 API（root 实现）

所有浏览器接口沿用现有登录 cookie；JSON 错误体沿用全站约定。

- `GET /api/prep/status` → `{enabled,model,limits}`。
- `GET /api/prep/sessions` → `{sessions:[{id,title,updatedAt,status}]}`。
- `POST /api/prep/sessions` `{title?}` → `{session}`。
- `GET /api/prep/sessions/:id` → `{session,messages,events,attachments,proposals,activeRun}`。
- `PATCH /api/prep/sessions/:id` `{title}`、`DELETE /api/prep/sessions/:id`。
- `POST /api/prep/sessions/:id/messages` `{content,attachmentIds:string[]}` → `{runId,status}`，立即返回并后台运行。
- `GET /api/prep/sessions/:id/events?after=0` → `{events,activeRun,messages,proposals,attachments}`，增量事件；前端可用约 1 秒轮询实现断线恢复和推理增量显示。
- `POST /api/prep/sessions/:id/cancel` `{runId}`。
- `POST /api/prep/sessions/:id/attachments?filename=<编码文件名>`：application/octet-stream 原始字节 → `{attachment}`；同源 fetch，前端不要 base64 膨胀。文件选择/粘贴/拖放使用同一函数。
- `GET /api/prep/attachments/:id`：鉴权下载，Content-Disposition attachment。
- `GET /api/prep/skills` → `{skills}`；`POST /api/prep/skills` `{name,content}` 上传 SKILL.md 文本；`DELETE /api/prep/skills/:id`。
- `PATCH /api/prep/proposals/:id` `{payload,version}` 重验并生成新预览；`POST /api/prep/proposals/:id/confirm` `{version}`、`POST /api/prep/proposals/:id/reject` `{}`。只有浏览器登录用户可确认，运行器不能确认自己的提案；旧版本确认返回409。

DTO：

```ts
Message = {id,role:'user'|'assistant',content,attachmentIds:string[],createdAt}
Attachment = {id,name,mime,size,kind:'upload'|'artifact',createdAt}
Event = {id:number,type:'status'|'reasoning'|'text'|'tool-start'|'tool-result'|'proposal'|'error'|'artifact',data:Record<string,unknown>,createdAt}
// reasoning/text data={text, ...}; status data={status,message}; tool events data={name,callId,input?,output?}
Proposal = {id,tool,description,payload,preview,version,status:'pending'|'applied'|'rejected'|'expired',createdAt}
Run = {id,status:'queued'|'running'|'waiting'|'cancelling'|'completed'|'cancelled'|'failed',error?,createdAt}
Skill = {id,name,content,createdAt}
```

初始限额可由环境变量配置；低资源部署按队列执行，不启动定时任务。前端只展示 enabled 真实状态，未配置模型或运行器时不伪装 AI 成功。

## 文件分工

- 教学后端负责人：`prisma/schema.prisma` 的班级/分组/试卷变更及教学路由、相关 lib/测试/迁移。保留 root 后续新增 Prep 模型；不要改 `src/index.ts`、env 和 prep 路由。
- 班级 UI 负责人：`scripts/class-studio.js`、`scripts/storybook-studio.js` 的名单/分组/试卷教师及学生交互；不运行安装脚本以避免共享 index 冲突。
- 备课 UI 负责人：新增 `scripts/prep-studio.js` 与 `scripts/install-prep-studio.mjs`，独立 `#/prep`、`#/prep/:id` 路由；不改其他模块或运行安装脚本。
- root：Prep 持久数据、接口、工具审批、DSH 运行器、配置/集成/部署/验收。涉及 schema 的 Prep 模型由 root 追加，与教学后端负责人保持区块互不覆盖。
