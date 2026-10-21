export function conversationRuns(state) {
  const runs = [], byId = new Map(), messageKeys = new Map();
  const get = (id) => {
    if (!byId.has(id)) {
      const run = { id, messages: [], events: [], artifacts: [], proposals: [] };
      runs.push(run);
      byId.set(id, run);
    }
    return byId.get(id);
  };
  let last = null;
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    const following = state.messages.slice(i + 1).find((next) => next.role === "user" || next.runId);
    const id = m.runId || (state.activeRun?.messageId === m.id ? state.activeRun.id : "") || (m.role === "user" ? following?.role === "assistant" && following.runId || i === state.messages.findLastIndex((row) => row.role === "user") && state.activeRun?.id || `message-${m.id}` : last?.id) || `message-${m.id}`;
    last = get(id);
    last.messages.push(m);
    messageKeys.set(m.id, id);
  }
  if (state.activeRun && !byId.has(state.activeRun.id)) get(state.activeRun.id);
  for (const e of state.events) {
    const datedPrompt = e.createdAt && state.messages.findLast((m) => m.role === "user" && m.createdAt && new Date(m.createdAt) <= new Date(e.createdAt));
    const id = e.runId || e.data?.runId || datedPrompt && messageKeys.get(datedPrompt.id) || runs[0]?.id || "history";
    get(id).events.push(e);
  }
  const files = new Map(state.attachments.filter((a) => a.kind === "artifact").map((a) => [a.id, a]));
  for (const run of runs) for (const e of run.events) if (e.type === "artifact" && files.has(e.data?.id)) {
    run.artifacts.push(files.get(e.data.id));
    files.delete(e.data.id);
  }
  for (const a of files.values()) {
    const prompt = a.createdAt && state.messages.findLast((m) => m.role === "user" && m.createdAt && new Date(m.createdAt) <= new Date(a.createdAt));
    get(prompt && messageKeys.get(prompt.id) || runs.at(-1)?.id || "history").artifacts.push(a);
  }
  for (const proposal of state.proposals) {
    const eventRun = runs.find((run) => run.events.some((e) => e.type === "proposal" && e.data?.id === proposal.id));
    get(proposal.runId || eventRun?.id || runs.at(-1)?.id || "history").proposals.push(proposal);
  }
  return runs;
}
