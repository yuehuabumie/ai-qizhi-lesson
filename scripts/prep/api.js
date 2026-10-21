export const API = "/api/prep";
export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body !== void 0 && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  const r = await fetch(API + path, { ...options, headers, body, credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.error?.message || (r.status === 401 ? "请先登录后使用智能备课" : `请求未完成（${r.status}）`));
    e.status = r.status;
    throw e;
  }
  return data;
}
