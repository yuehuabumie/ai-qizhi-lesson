const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
export function sandboxHTML(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll("link,base,meta[http-equiv],meta[name]").forEach((el) => {
    const equiv = (el.getAttribute("http-equiv") || "").trim().toLowerCase(), name = (el.getAttribute("name") || "").trim().toLowerCase();
    if (el.matches("link,base") || ["content-security-policy", "content-security-policy-report-only", "refresh"].includes(equiv) || name === "referrer") el.remove();
  });
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = HTML_PREVIEW_CSP;
  doc.head.prepend(policy);
  const referrer = doc.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  policy.after(referrer);
  const safe = "<!doctype html>\n" + doc.documentElement.outerHTML;
  const wrapper = new DOMParser().parseFromString("<!doctype html><html><head></head><body></body></html>", "text/html");
  const wrapperPolicy = wrapper.createElement("meta");
  wrapperPolicy.httpEquiv = "Content-Security-Policy";
  wrapperPolicy.content = HTML_PREVIEW_CSP + "; frame-src about:";
  wrapper.head.append(wrapperPolicy);
  const style = wrapper.createElement("style");
  style.textContent = "html,body{height:100%;margin:0;background:#fff}iframe{display:block;width:100%;height:100%;border:0}";
  wrapper.head.append(style);
  const code = wrapper.createElement("script");
  code.textContent = `const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.title='互动网页内容';frame.srcdoc=${JSON.stringify(safe).replace(/</g, "\\u003c")};document.body.append(frame);`;
  wrapper.body.append(code);
  return "<!doctype html>\n" + wrapper.documentElement.outerHTML;
}
