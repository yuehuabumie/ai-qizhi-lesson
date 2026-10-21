import { icon } from './icons.js';
import { esc } from './presentation.js';

export function createModalManager() {
  let modal = null;
  let returnFocus = null;
  let editorSerial = 0;
  const modalStack = [];
  function closeModal() {
    if (!modal) return;
    const old = modal, focus = returnFocus;
    modal = null;
    old.close?.();
    old.remove();
    const previous = modalStack.pop();
    if (previous) {
      modal = previous.el;
      returnFocus = previous.returnFocus;
    } else returnFocus = null;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    else if (previous?.focusedFile) [...modal.querySelectorAll("[data-prep-preview]")].find((button) => button.dataset.prepPreview === previous.focusedFile)?.focus({ preventScroll: true });
  }
  function closeModals() {
    while (modal) closeModal();
  }
  function showModal(title, body, footer = "", stack = false) {
    if (stack && modal) {
      modalStack.push({ el: modal, returnFocus, focusedFile: document.activeElement?.dataset.prepPreview });
      modal = null;
    } else closeModals();
    returnFocus = document.activeElement;
    const titleId = `prep-modal-title-${++editorSerial}`;
    const el = document.createElement("dialog");
    el.className = "prep-modal";
    el.setAttribute("aria-labelledby", titleId);
    el.innerHTML = `<form method="dialog" class="prep-modal-head"><h2 id="${titleId}">${esc(title)}</h2><button class="prep-icon-btn" aria-label="关闭" value="cancel">${icon("close")}</button></form><div class="prep-modal-body">${body}</div><div class="prep-modal-error" role="alert" hidden></div>${footer ? `<footer class="prep-modal-foot">${footer}</footer>` : ""}`;
    document.body.append(el);
    modal = el;
    el.addEventListener("close", () => {
      if (modal === el) closeModal();
    });
    el.addEventListener("click", (e) => {
      if (e.target === el) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
      }
    });
    el.showModal();
    (el.querySelector("[data-autofocus]") || el.querySelector("button"))?.focus();
    return el;
  }
  const modalError = (el, text) => {
    const box = el.querySelector(".prep-modal-error");
    box.hidden = !text;
    box.textContent = text;
  };
  return { get current() { return modal }, get stack() { return modalStack }, closeModal, closeModals, showModal, modalError };
}
