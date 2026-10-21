import { createModalManager } from './modals.js';
import { esc, json, bytes, label, toolLabel, statusMessage } from "./presentation.js";
import { shell, emptyThread, attachmentLink } from "./templates.js";
import { icon } from "./icons.js";
import { API, api } from "./api.js";
import { conversationRuns } from "./conversation.js";
import { sandboxHTML } from "./sandbox.js";
import { ensureStyle } from "./styles.js";
import { createTeachingHub } from "./teaching-hub.js";
export function createPrepStudio() {
  const teachingHub = createTeachingHub();
  const dialogs = createModalManager();
  const { closeModal, closeModals, showModal, modalError } = dialogs;
  const INITIAL_HASH = location.hash;
  const HTML_PREVIEW_LIMIT = 2 * 1024 * 1024;
  const ACTIVE = new Set(["queued", "running", "waiting", "cancelling"]);
  const STATUS = { queued: "排队中", running: "正在备课", waiting: "等待确认", cancelling: "正在停止", completed: "已完成", cancelled: "已停止", failed: "未完成" };
  let root = null;
  let epoch = 0;
  let timer = 0;
  let polling = false;
  let creation = null;
  let draftOwner = null;
  let editorSerial = 0;
  let fullscreenSlot = null;
  let fullscreenOverflow = "";
  let fullscreenBackground = [];
  const ctx = { router: null };
  const drafts = new Map();
  const transfers = new Map();
  let state = blank();
  function blank() {
    return { id: "", session: null, sessions: [], messages: [], events: [], attachments: [], proposals: [], activeRun: null, after: 0, hasMore: false, ready: false, identityReady: false, pendingDraft: { content: "", files: [] }, status: null, loading: false, error: "", pollError: "", panel: "chat", busy: new Set(), skills: [], skillsLoaded: false };
  }
  const current = (page, id) => root && epoch === page && state.id === id;
  function draft() {
    if (!state.identityReady) return state.pendingDraft;
    const key = state.id || "new";
    if (!drafts.has(key)) drafts.set(key, { content: "", files: [] });
    return drafts.get(key);
  }
  function clearDrafts() {
    for (const d of drafts.values()) d.files.forEach((f) => {
      transfers.get(f.key)?.abort();
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    drafts.clear();
  }
  function error(message) {
    if (!root) return;
    state.error = message || "";
    const box = root.querySelector("[data-prep-error]");
    box.hidden = !message;
    box.querySelector("span").textContent = message || "";
  }
  function toast(message) {
    if (!root) return;
    const box = root.querySelector("[data-prep-notice]");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(box._timer);
    box._timer = setTimeout(() => {
      box.hidden = true;
    }, 4500);
  }
  function renderSessions() {
    if (!root) return;
    root.querySelector("[data-prep-sessions]").innerHTML = state.sessions.length ? state.sessions.map((s) => `<a href="#/prep/${encodeURIComponent(s.id)}" data-prep-session="${esc(s.id)}" class="prep-session ${state.id === s.id ? "is-current" : ""}" ${state.id === s.id ? 'aria-current="page"' : ""}>${icon("chat")}<span>${esc(s.title || "未命名对话")}</span>${ACTIVE.has(s.status) ? '<i class="prep-session-live" aria-label="任务进行中"></i>' : ""}</a>`).join("") : '<p class="prep-empty-small">还没有备课对话。<br>从一条需求或一份资料开始。</p>';
  }
  function markdown(text) {
    return window.__AIQ_PREP_MARKDOWN__ ? window.__AIQ_PREP_MARKDOWN__(text, { attachments: state.attachments }) : esc(text);
  }
  function artifactCard(a) {
    const html = String(a.mime).split(";")[0].trim().toLowerCase() === "text/html";
    const format = String(a.name || "").split(".").pop().toUpperCase();
    return `<section class="prep-artifact-card" data-prep-artifact="${esc(a.id)}"><div class="prep-artifact-icon">${icon("file")}</div><div class="prep-artifact-info"><h4>${esc(a.name || "生成文件")}</h4><p>${esc(format.length < 12 ? format : "文件")} · ${bytes(a.size)} · 已生成</p><div class="prep-artifact-actions"><a class="prep-btn is-artifact" href="${API}/attachments/${encodeURIComponent(a.id)}" download aria-label="下载 ${esc(a.name)}">${icon("download")}下载<span class="prep-sr"> ${esc(a.name)}</span></a>${html ? `<button type="button" class="prep-btn" data-prep-preview="${esc(a.id)}">预览</button>` : ""}</div></div></section>`;
  }
  function proposalCard(p, existingOpen) {
    return `<section class="prep-proposal ${p.status === "pending" ? "is-pending" : ""}" data-prep-proposal="${esc(p.id)}"><div class="prep-proposal-tag">${icon(p.status === "applied" ? "check" : "edit")}${{ pending: "请你核对", applied: "已执行", rejected: "未执行", expired: "预览已失效" }[p.status] || esc(p.status)}</div><h3 tabindex="-1" data-prep-proposal-title="${esc(p.id)}">${esc(p.description || toolLabel(p.tool))}</h3><details data-prep-detail="proposal-${esc(p.id)}" ${existingOpen.has(`proposal-${p.id}`) ? "open" : ""}><summary>查看完整预览</summary><div class="prep-preview">${previewHTML(p.preview ?? p.payload)}</div></details>${p.status === "pending" ? `<p class="prep-subtle">确认后才会修改班级、名单或作业。</p><div class="prep-proposal-actions"><button type="button" class="prep-btn prep-primary" data-prep-confirm="${esc(p.id)}" ${state.busy.has(`proposal:${p.id}`) ? 'disabled aria-busy="true"' : ""}>${state.busy.has(`proposal:${p.id}`) ? "处理中…" : "确认执行"}</button><button type="button" class="prep-btn" data-prep-edit="${esc(p.id)}">编辑</button><button type="button" class="prep-btn" data-prep-reject="${esc(p.id)}">暂不执行</button></div>` : ""}</section>`;
  }
  function renderRunEvents(run, existingOpen) {
    const groups = [];
    for (const e of run.events) {
      const previous = groups.at(-1);
      if (["text", "reasoning"].includes(e.type) && previous?.type === e.type) previous.text += e.data?.text || "";
      else groups.push({ ...e, text: e.data?.text || "" });
    }
    const results = new Map(run.events.filter((e) => e.type === "tool-result" && e.data?.callId).map((e) => [e.data.callId, e]));
    const started = new Set(run.events.filter((e) => e.type === "tool-start").map((e) => e.data?.callId));
    const final = run.messages.filter((m) => m.role === "assistant").at(-1);
    const lastText = groups.findLast((e) => e.type === "text");
    const duplicate = final && lastText?.text.trim() === final.content?.trim() ? lastText : null;
    const running = ACTIVE.has(state.activeRun?.status) && run.id === state.activeRun?.id;
    return groups.map((e) => {
      const d = e.data || {}, id = `event-${e.id}`, open = existingOpen.has(id) ? "open" : "";
      if (e.type === "text") return e === duplicate || !e.text ? "" : `<div class="prep-progress prep-markdown" data-prep-progress="${esc(e.id)}">${markdown(e.text)}</div>`;
      if (e.type === "reasoning") return `<details class="prep-event prep-reasoning" data-prep-detail="${esc(id)}" ${open}><summary>${icon("brain")}<span>思考过程</span><span class="prep-disclosure-hint">展开</span></summary><div class="prep-event-text">${esc(e.text)}</div></details>`;
      if (e.type === "tool-start") {
        const result = results.get(d.callId), failed = result?.data?.isError;
        return `<details class="prep-event prep-tool-event ${failed ? "is-error" : ""}" data-prep-detail="${esc(id)}" ${open}><summary>${icon(result ? failed ? "close" : "check" : "tool")}<span>${esc(toolLabel(d.name))}</span><small>${result ? failed ? "未完成" : "已返回" : running ? state.activeRun.status === "cancelling" ? "停止中" : "执行中" : "已记录"}</small></summary>${d.input !== void 0 ? `<h4>调用内容</h4><pre>${esc(json(d.input))}</pre>` : ""}${result ? `<h4>工具返回</h4><pre>${esc(json(result.data?.output ?? result.data?.result ?? result.data))}</pre>` : ""}</details>`;
      }
      if (e.type === "tool-result") return d.callId && started.has(d.callId) ? "" : `<details class="prep-event prep-tool-event" data-prep-detail="${esc(id)}" ${open}><summary>${icon("check")}<span>${esc(toolLabel(d.name))}已返回</span></summary><pre>${esc(json(d.output ?? d))}</pre></details>`;
      if (e.type === "artifact") {
        const a = run.artifacts.find((a2) => a2.id === d.id);
        return a ? artifactCard(a) : "";
      }
      if (e.type === "proposal") return "";
      if (e.type === "error") return `<div class="prep-event is-error">${esc(d.message || d.text || "任务未能完成，请稍后重试。")}</div>`;
      return `<div class="prep-event prep-status-event">${icon(d.status === "completed" ? "check" : "spark")}<span>${esc(statusMessage(d.message) || STATUS[d.status] || "状态已更新")}</span></div>`;
    }).join("");
  }
  function renderMessages() {
    if (!root) return;
    const thread = root.querySelector("[data-prep-thread]");
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100;
    const existingOpen = new Set([...thread.querySelectorAll("details[data-prep-detail][open]")].map((el) => el.dataset.prepDetail));
    const focusedDetail = thread.contains(document.activeElement) ? document.activeElement.closest("[data-prep-detail]")?.dataset.prepDetail : null;
    const rows = conversationRuns(state).map((run) => {
      const teachers = run.messages.filter((m) => m.role === "user").map((m) => `<article class="prep-message is-user" data-prep-message="${esc(m.id)}"><div class="prep-message-avatar" aria-hidden="true">我</div><div class="prep-message-body"><span class="prep-message-by">你</span><div class="prep-message-text">${esc(m.content || "")}</div>${(m.attachmentIds || []).length ? `<div class="prep-message-files">${m.attachmentIds.map((id) => attachmentLink(id, state.attachments.find((a) => a.id === id)?.name)).join("")}</div>` : ""}</div></article>`).join("");
      const assistants = run.messages.filter((m) => m.role === "assistant");
      const active = run.id === state.activeRun?.id && ACTIVE.has(state.activeRun.status);
      const events = renderRunEvents(run, existingOpen);
      const files = run.artifacts.filter((a) => !run.events.some((e) => e.type === "artifact" && e.data?.id === a.id)).map(artifactCard).join("");
      const final = assistants.map((m) => `<div class="prep-final-response" data-prep-final="${esc(m.id)}"><div class="prep-message-text prep-markdown">${markdown(m.content || "")}</div>${(m.attachmentIds || []).map((id) => attachmentLink(id, state.attachments.find((a) => a.id === id)?.name)).join("")}</div>`).join("");
      const proposals = run.proposals.length ? `<div class="prep-run-proposals" data-prep-proposals>${run.proposals.map((p) => proposalCard(p, existingOpen)).join("")}</div>` : "";
      const assistant = events || files || final || proposals || active ? `<article class="prep-message is-assistant" data-prep-run="${esc(run.id)}" ${assistants.length ? `data-prep-message="${esc(assistants[0].id)}"` : active ? "data-prep-stream" : ""}><div class="prep-message-avatar" aria-hidden="true">${icon("spark")}</div><div class="prep-message-body"><span class="prep-message-by">智能备课</span><div class="prep-run-events" data-prep-events>${events}</div>${proposals}${final}${files}${active ? `<div class="prep-live-status" role="status"><span class="prep-run-dot is-active"></span>${esc(STATUS[state.activeRun.status] || "正在备课")}<span class="prep-subtle">进展会在这里持续更新</span></div>` : ""}</div></article>` : "";
      return teachers + assistant;
    }).join("");
    const html = state.loading ? '<div class="prep-loading" role="status">正在打开对话…</div>' : rows || emptyThread();
    if (thread._html !== html) {
      thread._html = html;
      thread.innerHTML = html;
      if (focusedDetail) [...thread.querySelectorAll("[data-prep-detail]")].find((el) => el.dataset.prepDetail === focusedDetail)?.querySelector("summary")?.focus({ preventScroll: true });
      if (nearBottom) thread.scrollTop = thread.scrollHeight;
      else root.querySelector('[data-prep-action="jump"]').hidden = false;
    }
    thread.setAttribute("aria-busy", String(state.loading));
  }
  function renderControls() {
    if (!root) return;
    const run = state.activeRun, active = ACTIVE.has(run?.status), d = draft();
    const title = root.querySelector("[data-prep-title]");
    title.textContent = state.session?.title || "开始一次新的备课";
    const status = root.querySelector("[data-prep-run-status]");
    status.textContent = run ? STATUS[run.status] || "任务状态更新中" : "资料与对话仅对你可见";
    status.setAttribute("role", "status");
    root.querySelector("[data-prep-chat-actions]").innerHTML = state.id ? `<button type="button" class="prep-icon-btn" data-prep-action="rename" aria-label="重命名当前对话">${icon("edit")}</button><button type="button" class="prep-icon-btn" data-prep-action="delete" aria-label="删除当前对话">${icon("trash")}</button>` : "";
    const send2 = root.querySelector("[data-prep-send]");
    send2.hidden = active;
    send2.disabled = !state.ready || state.status?.enabled !== true || state.loading || active || state.busy.has("send") || d.files.some((f) => f.status !== "done") || !d.content.trim() && !d.files.length;
    send2.setAttribute("aria-busy", String(state.busy.has("send")));
    const cancelling = state.busy.has("cancel") || run?.status === "cancelling";
    const cancel = root.querySelector('[data-prep-action="cancel"]');
    cancel.hidden = !active;
    cancel.disabled = cancelling;
    cancel.setAttribute("aria-busy", String(cancelling));
    cancel.innerHTML = `${icon("stop")}${cancelling ? "正在停止" : "停止"}`;
    root.querySelector("#prep-message").disabled = !state.identityReady;
    root.querySelector('[data-prep-action="attach"]').disabled = !state.ready || state.status?.enabled !== true || state.loading;
    const create = root.querySelector('[data-prep-action="new"]');
    create.disabled = !state.ready || state.busy.has("new");
    create.setAttribute("aria-busy", String(state.busy.has("new")));
    const model = root.querySelector("[data-prep-model]");
    model.textContent = state.status?.model || "DeepSeek";
    const disabled = root.querySelector("[data-prep-disabled]");
    disabled.hidden = !state.ready || state.status?.enabled === true;
    disabled.textContent = state.status?.message || "智能备课尚未启用，管理员配置模型与执行环境后即可使用。";
    root.querySelectorAll("[data-prep-panel]").forEach((b) => {
      const on = b.dataset.prepPanel === state.panel;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    root.dataset.panel = state.panel;
    const count = state.attachments.filter((a) => a.kind === "artifact").length;
    const files = root.querySelector('[data-prep-action="files"]');
    files.disabled = !state.identityReady || state.loading;
    files.setAttribute("aria-label", `查看已生成文件，当前对话 ${count} 个文件`);
    const badge = root.querySelector("[data-prep-file-count]");
    badge.hidden = !count;
    badge.textContent = String(count);
    const fullscreen = root.classList.contains("is-fullscreen"), toggle = root.querySelector('[data-prep-action="fullscreen"]');
    toggle.setAttribute("aria-pressed", String(fullscreen));
    toggle.setAttribute("aria-label", fullscreen ? "退出全屏" : "全屏工作台");
    toggle.title = fullscreen ? "退出全屏（Esc）" : "全屏工作台";
    toggle.innerHTML = icon(fullscreen ? "collapse" : "expand") + `<span>${fullscreen ? "退出全屏" : "全屏工作台"}</span>`;
  }
  function renderQueue() {
    if (!root) return;
    root.querySelector("[data-prep-queue]").innerHTML = draft().files.map((f) => `<div class="prep-upload ${f.status === "failed" ? "is-failed" : ""}" data-prep-upload="${esc(f.key)}">${f.preview ? `<img src="${esc(f.preview)}" alt="" loading="lazy">` : icon("file")}<div><strong>${esc(f.file.name || "图片")}</strong><span>${f.status === "done" ? bytes(f.file.size) : f.status === "failed" ? esc(f.error || "上传失败") : "正在上传…"}</span></div>${f.status === "failed" ? `<button type="button" class="prep-icon-btn" data-prep-retry="${esc(f.key)}" aria-label="重新上传 ${esc(f.file.name)}">${icon("refresh")}</button>` : ""}<button type="button" class="prep-icon-btn" data-prep-remove="${esc(f.key)}" aria-label="移除 ${esc(f.file.name)}">${icon("close")}</button></div>`).join("");
    renderControls();
  }
  function previewHTML(value, depth = 0) {
    if (value == null || value === "") return '<span class="prep-subtle">未填写</span>';
    if (typeof value !== "object") return `<span>${esc(value === true ? "是" : value === false ? "否" : value)}</span>`;
    if (depth > 5) return `<pre>${esc(json(value))}</pre>`;
    if (Array.isArray(value)) return `<ol class="prep-preview-list">${value.slice(0, 120).map((v) => `<li>${previewHTML(v, depth + 1)}</li>`).join("")}${value.length > 120 ? `<li>另有 ${value.length - 120} 项</li>` : ""}</ol>`;
    return `<dl class="prep-preview-data">${Object.entries(value).filter(([k]) => !["id", "classId", "ownerId", "memberId", "assignmentId"].includes(k)).map(([k, v]) => `<div><dt>${esc(label(k))}</dt><dd>${previewHTML(v, depth + 1)}</dd></div>`).join("")}</dl>`;
  }
  function filesDialog() {
    return dialogs.current?.classList.contains("prep-files-modal") ? dialogs.current : dialogs.stack.find((entry) => entry.el.classList.contains("prep-files-modal"))?.el;
  }
  function renderFilesDialog() {
    const el = filesDialog();
    if (!el) return;
    const box = el.querySelector("[data-prep-artifacts]"), artifacts = state.attachments.filter((a) => a.kind === "artifact");
    const html = artifacts.length ? `<p class="prep-file-help">当前对话共生成 ${artifacts.length} 个文件，点击下载保存到手机或电脑。</p>${artifacts.map(artifactCard).join("")}` : '<div class="prep-files-empty">' + icon("file") + "<h3>当前对话还没有生成文件</h3><p>生成完成后，文件会显示在这里，也会出现在备课对话中。</p></div>";
    if (box._html !== html) {
      const focus = box.contains(document.activeElement) ? { id: document.activeElement.closest("[data-prep-artifact]")?.dataset.prepArtifact, preview: document.activeElement.hasAttribute("data-prep-preview") } : null;
      box._html = html;
      box.innerHTML = html;
      if (focus) [...box.querySelectorAll("[data-prep-artifact]")].find((card) => card.dataset.prepArtifact === focus.id)?.querySelector(focus.preview ? "[data-prep-preview]" : "a[download]")?.focus({ preventScroll: true });
    }
  }
  function showFiles() {
    if (!root || !state.identityReady || state.loading) return;
    const el = showModal("已生成文件", `<p class="prep-subtle">当前对话：${esc(state.session?.title || "新的备课对话")}</p><div data-prep-artifacts></div>`, '<button type="button" class="prep-btn" data-dialog-cancel>关闭</button>');
    el.classList.add("prep-files-modal");
    el.addEventListener("click", (e) => {
      const preview = e.target.closest("[data-prep-preview]");
      if (preview) previewArtifact(preview.dataset.prepPreview);
    });
    el.querySelector("[data-dialog-cancel]").onclick = closeModal;
    renderFilesDialog();
  }
  function renderActivity() {
    if (!root) return;
    renderMessages();
    renderFilesDialog();
    const pollError = root.querySelector("[data-prep-poll-error]");
    pollError.hidden = !state.pollError;
    pollError.textContent = state.pollError;
  }
  function renderAll() {
    renderSessions();
    renderActivity();
    renderQueue();
    renderControls();
  }
  function applyDetail(data) {
    state.hasMore = !!data.hasMore;
    if (data.session) state.session = data.session;
    for (const key of ["messages", "attachments", "proposals"]) if (Array.isArray(data[key])) state[key] = data[key];
    if (Object.hasOwn(data, "activeRun")) state.activeRun = data.activeRun;
    if (Array.isArray(data.events)) {
      const map = new Map(state.events.map((e) => [String(e.id), e]));
      for (const event of data.events) {
        const e = { ...event, data: typeof event.data === "string" ? (() => {
          try {
            return JSON.parse(event.data);
          } catch {
            return { text: event.data };
          }
        })() : event.data || {} };
        map.set(String(e.id), e);
        state.after = Math.max(state.after, Number(e.id) || 0);
      }
      state.events = [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
    }
  }
  async function loadSessions() {
    const page = epoch;
    try {
      const data = await api("/sessions");
      if (root && epoch === page) {
        state.sessions = data.sessions || [];
        renderSessions();
      }
    } catch (e) {
      if (root && epoch === page) error(e.message);
    }
  }
  async function openSession(id = "") {
    const page = ++epoch;
    clearTimeout(timer);
    timer = 0;
    polling = false;
    closeModals();
    state.id = id;
    state.session = null;
    state.messages = [];
    state.events = [];
    state.attachments = [];
    state.proposals = [];
    state.activeRun = null;
    state.after = 0;
    state.hasMore = false;
    state.error = "";
    state.pollError = "";
    state.loading = !!id;
    state.panel = "chat";
    creation = null;
    root.querySelector("#prep-message").value = draft().content;
    error("");
    renderAll();
    if (!id) return;
    try {
      const data = await api(`/sessions/${encodeURIComponent(id)}`);
      if (!current(page, id)) return;
      applyDetail(data);
    } catch (e) {
      if (current(page, id)) error(e.message);
    } finally {
      if (current(page, id)) {
        state.loading = false;
        renderAll();
        schedulePoll();
      }
    }
  }
  async function refreshDetail() {
    const page = epoch, id = state.id;
    if (!id) return;
    const data = await api(`/sessions/${encodeURIComponent(id)}`);
    if (current(page, id)) {
      applyDetail(data);
      state.pollError = "";
      renderAll();
      schedulePoll();
    }
  }
  function schedulePoll(delay = 1e3) {
    clearTimeout(timer);
    if (root && state.id && (state.hasMore || ACTIVE.has(state.activeRun?.status))) timer = setTimeout(poll, state.hasMore ? 50 : document.hidden ? Math.max(4e3, delay) : delay);
  }
  async function poll() {
    if (polling || !root || !state.id) return;
    const page = epoch, id = state.id;
    polling = true;
    let retry = 1e3;
    try {
      const data = await api(`/sessions/${encodeURIComponent(id)}/events?after=${state.after}`);
      if (!current(page, id)) return;
      const oldStatus = state.activeRun?.status;
      applyDetail(data);
      state.pollError = "";
      renderActivity();
      renderControls();
      if (oldStatus !== state.activeRun?.status) loadSessions();
    } catch (e) {
      if (current(page, id)) {
        state.pollError = `状态暂未同步：${e.message}。正在重试，任务会在后台继续。`;
        renderActivity();
        retry = 4e3;
      }
    } finally {
      if (current(page, id)) {
        polling = false;
        schedulePoll(retry);
      }
    }
  }
  async function navigate(id) {
    if (ctx.router) await ctx.router.push(id ? `/prep/${encodeURIComponent(id)}` : "/prep");
    else await openSession(id);
  }
  async function ensureSession() {
    if (state.id) return state.id;
    if (creation) return creation;
    const page = epoch;
    creation = (async () => {
      const data = await api("/sessions", { method: "POST", body: {} });
      if (!root || epoch !== page) throw new Error("页面已切换，请重新选择对话");
      const previousDraft = draft();
      drafts.set(data.session.id, previousDraft);
      drafts.delete("new");
      state.id = data.session.id;
      state.session = data.session;
      state.sessions = [data.session, ...state.sessions.filter((s) => s.id !== data.session.id)];
      if (ctx.router) await ctx.router.replace({ path: `/prep/${encodeURIComponent(state.id)}`, state: { prepCreated: true } });
      renderSessions();
      renderControls();
      return state.id;
    })().finally(() => {
      creation = null;
    });
    return creation;
  }
  async function newSession() {
    if (state.busy.has("new")) return;
    const page = epoch;
    state.busy.add("new");
    renderControls();
    try {
      const data = await api("/sessions", { method: "POST", body: {} });
      if (!root || page !== epoch) return;
      state.sessions = [data.session, ...state.sessions];
      await navigate(data.session.id);
      root?.querySelector("#prep-message")?.focus();
    } catch (e) {
      if (page === epoch) error(e.message);
    } finally {
      state.busy.delete("new");
      renderControls();
    }
  }
  async function addFiles(files) {
    if (!root || !state.ready || state.status?.enabled !== true) return;
    const d = draft(), limit = Number(state.status?.limits?.maxFileBytes || state.status?.limits?.fileBytes || 25 * 1024 * 1024);
    const maxFiles = Number(state.status?.limits?.maxAttachments || 10);
    for (const file of [...files]) {
      if (!file || !file.name && !file.type) continue;
      if (d.files.length >= maxFiles) {
        error(`每次最多添加 ${maxFiles} 个附件`);
        break;
      }
      if (file.size > limit) {
        error(`${file.name || "文件"}超过单文件 ${bytes(limit)} 的上限`);
        continue;
      }
      if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) {
        error("暂不支持压缩包，请直接上传其中的文档或图片");
        continue;
      }
      const item = { key: crypto.randomUUID(), file, status: "pending", error: "", id: null, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" };
      d.files.push(item);
      upload(item, d);
    }
    renderQueue();
  }
  async function upload(item, ownerDraft) {
    if (!ownerDraft.files.includes(item) || item.status === "uploading") return;
    item.status = "uploading";
    item.error = "";
    renderQueue();
    const controller = new AbortController();
    transfers.set(item.key, controller);
    try {
      const id = await ensureSession();
      if (!ownerDraft.files.includes(item)) return;
      const data = await api(`/sessions/${encodeURIComponent(id)}/attachments?filename=${encodeURIComponent(item.file.name || "粘贴图片.png")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: item.file, signal: controller.signal });
      item.id = data.attachment.id;
      item.status = "done";
      if (state.id === id) state.attachments = [...state.attachments.filter((a) => a.id !== item.id), data.attachment];
    } catch (e) {
      if (ownerDraft.files.includes(item)) {
        item.status = "failed";
        item.error = e.name === "AbortError" ? "上传已停止，可重新上传" : e.message;
      }
    } finally {
      transfers.delete(item.key);
      if (root && draft() === ownerDraft) renderQueue();
    }
  }
  async function send() {
    if (root.querySelector("[data-prep-send]").disabled) return;
    const d = draft(), content = d.content, files = [...d.files], text = content.trim(), ids = files.map((f) => f.id), sendingState = state, page = epoch;
    let id = state.id;
    sendingState.busy.add("send");
    error("");
    renderControls();
    try {
      id = await ensureSession();
      await api(`/sessions/${encodeURIComponent(id)}/messages`, { method: "POST", body: { content: text, attachmentIds: ids } });
      if (d.content === content) d.content = "";
      files.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      d.files = d.files.filter((file) => !files.includes(file));
      if (!current(page, id)) return;
      root.querySelector("#prep-message").value = d.content;
      await refreshDetail();
      if (!current(page, id)) return;
      await loadSessions();
      if (current(page, id)) root.querySelector("#prep-message").focus();
    } catch (e) {
      if (current(page, id)) error(e.message);
    } finally {
      sendingState.busy.delete("send");
      if (root && state === sendingState) renderQueue();
    }
  }
  async function cancelRun() {
    const run = state.activeRun, id = state.id, page = epoch;
    if (!run || run.status === "cancelling" || state.busy.has("cancel")) return;
    state.busy.add("cancel");
    renderControls();
    try {
      await api(`/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { runId: run.id } });
      if (state.id === id) await refreshDetail();
    } catch (e) {
      if (epoch === page) error(e.message);
    } finally {
      state.busy.delete("cancel");
      renderControls();
    }
  }
  async function proposalAction(id, action) {
    const p = state.proposals.find((v) => v.id === id), page = epoch;
    if (!p || p.status !== "pending" || state.busy.has(`proposal:${id}`)) return;
    state.busy.add(`proposal:${id}`);
    renderActivity();
    try {
      await api(`/proposals/${encodeURIComponent(id)}/${action}`, { method: "POST", body: action === "confirm" ? { version: p.version } : {} });
      if (root && page === epoch) {
        await refreshDetail();
        root.querySelector(`[data-prep-proposal-title="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }
    } catch (e) {
      if (page !== epoch) return;
      if (e.status === 409) {
        await refreshDetail().catch(() => {
        });
        error("预览已更新，请重新核对最新内容后确认");
      } else error(e.message);
    } finally {
      state.busy.delete(`proposal:${id}`);
      if (page === epoch) renderActivity();
    }
  }
  async function previewArtifact(id) {
    const file = state.attachments.find((a) => a.id === id && a.kind === "artifact" && String(a.mime).split(";")[0].trim().toLowerCase() === "text/html");
    if (!file) return;
    const page = epoch, controller = new AbortController();
    const el = showModal(file.name || "互动网页预览", '<p class="prep-subtle">预览仅运行自包含 HTML，外部资源和联网访问已禁止。需要完整文件时仍可下载。</p><p class="prep-subtle" data-prep-preview-loading role="status">正在加载预览…</p><div class="prep-preview-frame-host" data-prep-preview-host hidden></div>', `<a class="prep-btn" href="${API}/attachments/${encodeURIComponent(file.id)}" download>${icon("download")}下载文件</a><button type="button" class="prep-btn" data-dialog-cancel>关闭预览</button>`, dialogs.current?.classList.contains("prep-files-modal"));
    el.classList.add("prep-preview-modal");
    el.addEventListener("close", () => controller.abort(), { once: true });
    el.addEventListener("cancel", () => controller.abort(), { once: true });
    el.querySelector("[data-dialog-cancel]").onclick = closeModal;
    try {
      if (file.size > HTML_PREVIEW_LIMIT) throw new Error("网页超过 2 MB，无法在线预览，请下载后查看");
      const response = await fetch(`${API}/attachments/${encodeURIComponent(file.id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("预览加载失败，请关闭后重试；也可直接下载文件");
      if (Number(response.headers.get("content-length")) > HTML_PREVIEW_LIMIT) {
        await response.body?.cancel();
        throw new Error("网页超过 2 MB，请下载后查看");
      }
      const parts = [];
      let total = 0;
      if (!response.body) throw new Error("文件内容不可用，请下载后查看");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > HTML_PREVIEW_LIMIT) {
            await reader.cancel();
            throw new Error("网页超过 2 MB，请下载后查看");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (dialogs.current !== el || page !== epoch || controller.signal.aborted) return;
      const content = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        content.set(part, offset);
        offset += part.byteLength;
      }
      const frame = document.createElement("iframe");
      frame.className = "prep-preview-frame";
      frame.title = file.name || "互动网页预览";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.srcdoc = sandboxHTML(new TextDecoder().decode(content));
      const host = el.querySelector("[data-prep-preview-host]");
      host.append(frame);
      host.hidden = false;
    } catch (e) {
      if (dialogs.current === el && page === epoch && !controller.signal.aborted) modalError(el, e.message || "预览加载失败，请下载后查看");
    } finally {
      if (dialogs.current === el) el.querySelector("[data-prep-preview-loading]").hidden = true;
    }
  }
  function manageSession(remove = false) {
    if (!state.session) return;
    const session = state.session, page = epoch;
    const el = showModal(remove ? "删除这段对话？" : "重命名对话", remove ? "<p>对话历史、上传的附件和生成文件将一起删除。请先停止进行中的任务，等待停止完成后再删除。</p>" : `<label class="prep-label" for="prep-session-name">对话名称</label><input class="prep-field" id="prep-session-name" maxlength="100" value="${esc(session.title)}" data-autofocus>`, `<button type="button" class="prep-btn" data-dialog-cancel>取消</button><button type="button" class="prep-btn ${remove ? "prep-danger" : "prep-primary"}" data-dialog-submit>${remove ? "删除对话" : "保存名称"}</button>`);
    el.querySelector("[data-dialog-cancel]").onclick = closeModal;
    el.querySelector("[data-dialog-submit]").onclick = async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const title = el.querySelector("input")?.value.trim();
        if (!remove && !title) throw new Error("请填写对话名称");
        await api(`/sessions/${encodeURIComponent(session.id)}`, { method: remove ? "DELETE" : "PATCH", body: remove ? void 0 : { title } });
        if (dialogs.current !== el || page !== epoch) return;
        closeModal();
        if (remove) {
          const d = drafts.get(session.id);
          d?.files.forEach((f) => {
            transfers.get(f.key)?.abort();
            if (f.preview) URL.revokeObjectURL(f.preview);
          });
          drafts.delete(session.id);
          await navigate("");
        } else await refreshDetail();
        await loadSessions();
      } catch (err) {
        if (dialogs.current === el) {
          modalError(el, err.message);
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      }
    };
  }
  function editorHTML(value, path = [], depth = 0) {
    const key = String(path[path.length - 1] || ""), attr = esc(JSON.stringify(path)), name = esc(label(key));
    if (depth > 6) return `<p class="prep-subtle">此部分结构较深，请在对话中说明修改要求。</p>`;
    if (Array.isArray(value)) return `<fieldset class="prep-edit-group"><legend>${name || "条目"}</legend>${value.map((v, i) => `<div class="prep-edit-row"><div>${editorHTML(v, [...path, i], depth + 1)}</div><button type="button" class="prep-icon-btn" data-editor-remove="${attr}" data-editor-index="${i}" aria-label="删除第 ${i + 1} 项">${icon("trash")}</button></div>`).join("")}<button type="button" class="prep-btn" data-editor-add="${attr}">${icon("plus")}添加一项</button></fieldset>`;
    if (value && typeof value === "object") return `<div class="prep-edit-object">${Object.entries(value).map(([k, v]) => editorHTML(v, [...path, k], depth + 1)).join("")}</div>`;
    const fieldId = `prep-edit-${++editorSerial}`;
    if (typeof value === "boolean") return `<label class="prep-checkbox" for="${fieldId}"><input id="${fieldId}" type="checkbox" data-editor-path="${attr}" data-editor-type="boolean" ${value ? "checked" : ""}>${name}</label>`;
    const isNumber = typeof value === "number" || value === null && ["score", "points", "answer"].includes(key);
    const readonly = ["id", "classId", "assignmentId", "memberId", "ownerId"].includes(key);
    return `<label class="prep-label" for="${fieldId}">${typeof path[path.length - 1] === "number" ? `第 ${Number(key) + 1} 项` : name}</label>${["stem", "description", "instructions", "explanation", "text"].includes(key) ? `<textarea class="prep-field" id="${fieldId}" rows="3" data-editor-path="${attr}" data-editor-type="text">${esc(value ?? "")}</textarea>` : `<input class="prep-field" id="${fieldId}" type="${isNumber ? "number" : "text"}" ${readonly ? "readonly" : ""} value="${esc(value ?? "")}" data-editor-path="${attr}" data-editor-type="${isNumber ? "number" : value === null ? "nullable" : "text"}">`}`;
  }
  function editProposal(id) {
    const proposal = state.proposals.find((p) => p.id === id);
    if (!proposal || proposal.status !== "pending") return;
    const payload = JSON.parse(JSON.stringify(proposal.payload)), version = proposal.version;
    const el = showModal("编辑待确认内容", `<p class="prep-subtle">保存后会重新校验并生成预览，核对后再确认执行。识别不清的信息请留空或在对话中补充。</p><div data-prep-editor>${editorHTML(payload)}</div>`, '<button type="button" class="prep-btn" data-dialog-cancel>取消</button><button type="button" class="prep-btn prep-primary" data-dialog-submit>保存并重新预览</button>');
    const at = (path) => path.reduce((v, k) => v[k], payload);
    const bind = () => {
      el.querySelectorAll("[data-editor-path]").forEach((field) => {
        field.oninput = () => {
          const path = JSON.parse(field.dataset.editorPath), key = path.pop(), parent = at(path);
          parent[key] = field.dataset.editorType === "boolean" ? field.checked : field.dataset.editorType === "number" ? field.value === "" ? null : Number(field.value) : field.dataset.editorType === "nullable" && field.value === "" ? null : field.value;
        };
      });
      el.querySelectorAll("[data-editor-remove]").forEach((b) => {
        b.onclick = () => {
          at(JSON.parse(b.dataset.editorRemove)).splice(Number(b.dataset.editorIndex), 1);
          repaint();
        };
      });
      el.querySelectorAll("[data-editor-add]").forEach((b) => {
        b.onclick = () => {
          const path = JSON.parse(b.dataset.editorAdd), arr = at(path), key = path[path.length - 1];
          const templates = { members: { name: "", studentNo: null, gender: null, score: null }, operations: { action: "add", name: "", studentNo: null, gender: null, score: null }, groups: { name: `第 ${arr.length + 1} 组`, memberIds: [] }, questions: { id: crypto.randomUUID(), type: "single", stem: "", options: ["", ""], answer: 0, points: 1, explanation: "" } };
          arr.push(templates[key] || (typeof arr[0] === "object" && arr[0] ? JSON.parse(JSON.stringify(arr[0])) : ""));
          repaint();
        };
      });
    };
    const repaint = () => {
      el.querySelector("[data-prep-editor]").innerHTML = editorHTML(payload);
      bind();
    };
    bind();
    el.querySelector("[data-dialog-cancel]").onclick = closeModal;
    el.querySelector("[data-dialog-submit]").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await api(`/proposals/${encodeURIComponent(id)}`, { method: "PATCH", body: { payload, version } });
        if (dialogs.current !== el) return;
        closeModal();
        await refreshDetail();
        toast("已更新预览，请核对后确认执行");
      } catch (e) {
        if (dialogs.current === el) {
          modalError(el, e.status === 409 ? "提案已在其他页面更新。请关闭后重新打开，核对最新内容。" : e.message);
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      }
    };
  }
  async function manageSkills() {
    const page = epoch;
    try {
      const data = await api("/skills");
      if (!root || page !== epoch) return;
      state.skills = data.skills || [];
      state.skillsLoaded = true;
    } catch (e) {
      error(e.message);
      return;
    }
    const el = showModal("我的 Skills", `<p class="prep-subtle">为自己的备课 Agent 添加技能说明。技能仅属于你的账号；MCP 由管理员配置。</p><div data-prep-skills></div><hr><h3>添加技能</h3><label class="prep-label" for="prep-skill-name">技能名称</label><input class="prep-field" id="prep-skill-name" maxlength="80" placeholder="例如：项目式学习教案"><label class="prep-label" for="prep-skill-content">SKILL.md 内容</label><textarea class="prep-field prep-skill-content" id="prep-skill-content" rows="8" placeholder="粘贴技能说明，或选择一份 SKILL.md 文件"></textarea><label class="prep-btn prep-skill-pick">${icon("paperclip")}选择 SKILL.md<input type="file" accept=".md,.txt,text/markdown,text/plain" data-prep-skill-file hidden></label>`, '<button type="button" class="prep-btn" data-dialog-cancel>关闭</button><button type="button" class="prep-btn prep-primary" data-dialog-submit>保存技能</button>');
    const paint = () => {
      el.querySelector("[data-prep-skills]").innerHTML = state.skills.length ? state.skills.map((skill) => `<div class="prep-skill-row"><div><strong>${esc(skill.name)}</strong><span>${esc((skill.content || "").slice(0, 100))}</span></div><button type="button" class="prep-icon-btn" data-skill-delete="${esc(skill.id)}" aria-label="删除技能 ${esc(skill.name)}">${icon("trash")}</button></div>`).join("") : '<p class="prep-empty-small">还没有个人技能。</p>';
      el.querySelectorAll("[data-skill-delete]").forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            await api(`/skills/${encodeURIComponent(b.dataset.skillDelete)}`, { method: "DELETE" });
            if (dialogs.current !== el) return;
            state.skills = state.skills.filter((s) => s.id !== b.dataset.skillDelete);
            paint();
          } catch (e) {
            if (dialogs.current === el) {
              modalError(el, e.message);
              b.disabled = false;
            }
          }
        };
      });
    };
    paint();
    el.querySelector("[data-dialog-cancel]").onclick = closeModal;
    el.querySelector("[data-prep-skill-file]").onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 128 * 1024) return modalError(el, "技能说明最多 128 KB");
      try {
        const text = await file.text();
        if (dialogs.current !== el) return;
        el.querySelector("#prep-skill-content").value = text;
        if (!el.querySelector("#prep-skill-name").value) el.querySelector("#prep-skill-name").value = file.name.replace(/\.(md|txt)$/i, "");
      } catch {
        modalError(el, "文件读取失败，请重新选择");
      }
    };
    el.querySelector("[data-dialog-submit]").onclick = async (e) => {
      const button = e.currentTarget, name = el.querySelector("#prep-skill-name").value.trim(), content = el.querySelector("#prep-skill-content").value;
      if (!name || !content.trim()) return modalError(el, "请填写技能名称和说明内容");
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const data = await api("/skills", { method: "POST", body: { name, content } });
        if (dialogs.current !== el) return;
        state.skills = [data.skill || { id: data.id, name, content }, ...state.skills];
        paint();
        el.querySelector("#prep-skill-name").value = "";
        el.querySelector("#prep-skill-content").value = "";
        modalError(el, "");
      } catch (err) {
        if (dialogs.current === el) modalError(el, err.message);
      } finally {
        if (dialogs.current === el) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      }
    };
  }
  function onClick(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const action = target.closest("[data-prep-action]")?.dataset.prepAction;
    if (action === "new") newSession();
    else if (action === "attach") root.querySelector("[data-prep-files]").click();
    else if (action === "cancel") cancelRun();
    else if (action === "rename") manageSession();
    else if (action === "delete") manageSession(true);
    else if (action === "skills") manageSkills();
    else if (action === "files") showFiles();
    else if (action === "fullscreen") toggleFullscreen();
    else if (action === "dismiss-error") error("");
    else if (action === "refresh") refreshDetail().catch((err) => error(err.message));
    else if (action === "jump") {
      const thread = root.querySelector("[data-prep-thread]");
      thread.scrollTop = thread.scrollHeight;
      root.querySelector('[data-prep-action="jump"]').hidden = true;
    }
    const panel = target.closest("[data-prep-panel]");
    if (panel) {
      state.panel = panel.dataset.prepPanel;
      renderControls();
    }
    const prompt = target.closest("[data-prep-prompt]");
    if (prompt) {
      draft().content = prompt.dataset.prepPrompt;
      root.querySelector("#prep-message").value = draft().content;
      root.querySelector("#prep-message").focus();
      renderControls();
    }
    const remove = target.closest("[data-prep-remove]");
    if (remove) {
      const d = draft(), item = d.files.find((f) => f.key === remove.dataset.prepRemove);
      if (item) {
        transfers.get(item.key)?.abort();
        if (item.preview) URL.revokeObjectURL(item.preview);
        d.files = d.files.filter((f) => f !== item);
        renderQueue();
      }
    }
    const retry = target.closest("[data-prep-retry]");
    if (retry) {
      const d = draft(), item = d.files.find((f) => f.key === retry.dataset.prepRetry);
      if (item) upload(item, d);
    }
    const confirm = target.closest("[data-prep-confirm]");
    if (confirm) proposalAction(confirm.dataset.prepConfirm, "confirm");
    const reject = target.closest("[data-prep-reject]");
    if (reject) proposalAction(reject.dataset.prepReject, "reject");
    const edit = target.closest("[data-prep-edit]");
    if (edit) editProposal(edit.dataset.prepEdit);
    const preview = target.closest("[data-prep-preview]");
    if (preview) previewArtifact(preview.dataset.prepPreview);
  }
  function toggleFullscreen(force, update = true) {
    if (!root) return;
    const on = force ?? !root.classList.contains("is-fullscreen");
    if (on === root.classList.contains("is-fullscreen")) return;
    if (on) {
      fullscreenSlot = document.createComment("prep-workspace");
      root.before(fullscreenSlot);
      document.body.append(root);
      fullscreenOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      fullscreenBackground = [...document.body.children].filter((el) => el !== root && !["SCRIPT", "STYLE", "LINK"].includes(el.tagName)).map((el) => ({ el, inert: el.inert }));
      fullscreenBackground.forEach(({ el }) => {
        el.inert = true;
      });
      root.classList.add("is-fullscreen");
    } else {
      root.classList.remove("is-fullscreen");
      if (fullscreenSlot?.isConnected) fullscreenSlot.replaceWith(root);
      fullscreenSlot?.remove();
      fullscreenSlot = null;
      document.documentElement.style.overflow = fullscreenOverflow;
      fullscreenBackground.forEach(({ el, inert }) => {
        el.inert = inert;
      });
      fullscreenBackground = [];
    }
    if (update) {
      renderControls();
      root.querySelector('[data-prep-action="fullscreen"]')?.focus({ preventScroll: true });
    }
  }
  function onWorkspaceKey(e) {
    if (e.key === "Escape" && !e.defaultPrevented && !dialogs.current && root?.classList.contains("is-fullscreen")) {
      e.preventDefault();
      toggleFullscreen(false);
    }
  }
  function onKey(e) {
    if (e.target.id === "prep-message" && e.key === "Enter" && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      send();
    }
    if (e.target.matches("[data-prep-panel]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const buttons = [...root.querySelectorAll("[data-prep-panel]")], i = buttons.indexOf(e.target);
      const n = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[n].click();
      buttons[n].focus();
    }
  }
  function mountPage(vm, id = "") {
    unmountPage();
    ensureStyle();
    state = blank();
    const host = vm.$el?.parentNode || document.querySelector("main") || document.body;
    root = document.createElement("div");
    root.className = "prep-page";
    root.dataset.prepRoot = "";
    root.innerHTML = shell();
    if (vm.$el?.parentNode === host) host.insertBefore(root, vm.$el);
    else host.append(root);
    teachingHub.sync();
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onWorkspaceKey);
    root.addEventListener("input", (e) => {
      if (e.target.id === "prep-message") {
        draft().content = e.target.value;
        renderControls();
      }
    });
    root.querySelector("[data-prep-form]").onsubmit = (e) => {
      e.preventDefault();
      send();
    };
    root.querySelector("[data-prep-files]").onchange = (e) => {
      addFiles(e.target.files || []);
      e.target.value = "";
    };
    root.addEventListener("paste", (e) => {
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
    let drag = 0;
    root.addEventListener("dragenter", (e) => {
      if ([...e.dataTransfer?.types || []].includes("Files")) {
        e.preventDefault();
        drag++;
        root.classList.add("is-dragging");
      }
    });
    root.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer?.types || []].includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    root.addEventListener("dragleave", () => {
      drag = Math.max(0, drag - 1);
      if (!drag) root.classList.remove("is-dragging");
    });
    root.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      drag = 0;
      root.classList.remove("is-dragging");
      addFiles(e.dataTransfer.files);
    });
    openSession(id);
    const mountedRoot = root;
    Promise.all([api("/status"), api("/sessions")]).then(([status, data]) => {
      if (root !== mountedRoot) return;
      if (draftOwner && (!status.userId || draftOwner !== status.userId)) clearDrafts();
      draftOwner = status.userId || null;
      state.identityReady = true;
      state.status = status;
      state.sessions = data.sessions || [];
      state.ready = true;
      root.querySelector("#prep-message").value = draft().content;
      renderAll();
    }).catch((e) => {
      if (root !== mountedRoot) return;
      clearDrafts();
      draftOwner = null;
      root.querySelector("#prep-message").value = "";
      state.ready = true;
      state.status = { enabled: false, message: e.message };
      error(e.message);
      renderAll();
    });
  }
  function unmountPage() {
    epoch++;
    clearTimeout(timer);
    timer = 0;
    polling = false;
    creation = null;
    closeModals();
    toggleFullscreen(false, false);
    document.removeEventListener("keydown", onWorkspaceKey);
    for (const controller of transfers.values()) controller.abort();
    transfers.clear();
    root?.remove();
    root = null;
  }
  const Component = { name: "LessonPrepStudio", mounted() {
    mountPage(this, String(this.$route.params.sessionId || ""));
  }, beforeRouteUpdate(to) {
    const id = String(to.params.sessionId || "");
    if (id !== state.id) openSession(id);
  }, beforeUnmount: unmountPage, render() {
    return null;
  } };
  async function boot() {
    await Promise.resolve();
    const start = Date.now();
    let app;
    while (!(app = document.querySelector("#app")?.__vue_app__) && Date.now() - start < 2e4) await new Promise((resolve) => setTimeout(resolve, 100));
    const router = app?.config?.globalProperties?.$router;
    if (!router) return;
    ctx.router = router;
    ensureStyle();
    for (const name of ["prep", "prep-session"]) if (router.hasRoute(name)) router.removeRoute(name);
    router.addRoute({ path: "/prep", name: "prep", component: Component, meta: { title: "智能备课", requiresAuth: true } });
    router.addRoute({ path: "/prep/:sessionId", name: "prep-session", component: Component, meta: { title: "智能备课", requiresAuth: true } });
    teachingHub.install();
    await router.isReady().catch(() => {
    });
    const raw = INITIAL_HASH.replace(/^#/, ""), [path, query] = raw.split("?");
    if (/^\/prep(?:\/[^/]+)?$/.test(path)) {
      const cur = router.currentRoute.value;
      if (cur.path !== path || !cur.matched.some((r) => r.components?.default === Component)) await router.replace({ path, query: Object.fromEntries(new URLSearchParams(query || "")), force: true }).catch(() => {
      });
    }
    teachingHub.sync();
  }
  return { boot, mount(id = "") {
    mountPage({ $el: null }, id);
  }, openSession, poll, unmountPage, dispose() {
    unmountPage();
    teachingHub.dispose();
  } };
}
