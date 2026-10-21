import { icon } from "./icons.js";
export function createTeachingHub() {
  let navObserver = null;
  const TEACH_ENTRIES = [
    { key: "teach", href: "#/teach", label: "教师工具箱", icon: "tool" },
    { key: "prep", href: "#/prep", label: "智能备课", icon: "spark" },
    { key: "classes", href: "#/me/classes", label: "班级管理", icon: "users" }
  ];
  function teachSection() {
    const path = String(location.hash || "").replace(/^#/, "").split("?")[0];
    if (path === "/teach") return "teach";
    if (path === "/prep" || path.startsWith("/prep/")) return "prep";
    if (path === "/me/classes" || path.startsWith("/me/classes/")) return "classes";
    return "";
  }
  function teachingTarget(section) {
    if (section === "teach") return document.querySelector(".teach-tabs")?.parentElement || null;
    if (section === "prep") return document.querySelector(".prep-page .prep-wrap");
    if (section === "classes") return document.querySelector(".cls-studio-root .cls-container");
    return null;
  }
  function syncTeachNav(section) {
    const active = ["teach", "prep", "classes"].includes(section);
    document.querySelectorAll('header.aiq-navbar a[href="#/teach"]').forEach((link) => {
      if (active) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
        link.dataset.teachSectionActive = "";
      } else if (link.dataset.teachSectionActive !== void 0) {
        link.classList.remove("is-active");
        link.removeAttribute("aria-current");
        delete link.dataset.teachSectionActive;
      }
    });
  }
  function syncTeachingHub() {
    const section = teachSection();
    syncTeachNav(section);
    const hubs = [...document.querySelectorAll("[data-teach-hub]")];
    const target = teachingTarget(section);
    if (section && !target) return;
    document.querySelectorAll('[data-teach-section]').forEach((container) => {
      if (container !== target) {
        container.classList.remove('teach-section-layout');
        delete container.dataset.teachSection;
      }
    });
    if (!target) {
      hubs.forEach((hub2) => hub2.remove());
      return;
    }
    target.classList.add('teach-section-layout');
    target.dataset.teachSection = section;
    let hub = hubs.shift();
    hubs.forEach((stale) => stale.remove());
    if (!hub) {
      hub = document.createElement("nav");
      hub.className = "teach-hub";
      hub.dataset.teachHub = "";
      hub.setAttribute("aria-label", "课堂教学入口");
      hub.innerHTML = `<div class="teach-hub-heading"><span class="teach-hub-title">课堂教学</span><span class="teach-hub-caption">备好一堂课，上好每一课</span></div><div class="teach-hub-links">${TEACH_ENTRIES.map((entry) => `<a href="${entry.href}" data-teach-entry="${entry.key}">${icon(entry.icon)}<span>${entry.label}</span></a>`).join("")}</div>`;
    }
    hub.querySelectorAll("[data-teach-entry]").forEach((link) => {
      const active = link.dataset.teachEntry === section;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (hub.parentElement !== target || target.firstElementChild !== hub) {
      target.prepend(hub);
    }
  }
  function installTeachingHub() {
    if (navObserver) return;
    syncTeachingHub();
    navObserver = new MutationObserver(syncTeachingHub);
    navObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", syncTeachingHub);
  }
  return { sync: syncTeachingHub, install: installTeachingHub, dispose() {
    navObserver?.disconnect();
    navObserver = null;
    window.removeEventListener("hashchange", syncTeachingHub);
  } };
}
