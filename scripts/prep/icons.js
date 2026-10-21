const ICONS = {
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  paperclip: '<path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  tool: '<path d="m14.7 6.3 3 3-9.4 9.4-3-3 9.4-9.4ZM14 3a5 5 0 0 0-5.7 6.8L3 15.1a3 3 0 0 0 4.2 4.2l5.3-5.3A5 5 0 0 0 20 8l-4 1-1-1 1-4-2-1Z"/>',
  users: '<path d="M16 20.5v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.6"/><circle cx="9" cy="7.5" r="3.5"/><path d="M22 20.5v-1.6a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17"/>',
  brain: '<path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 2 7 4 4 0 0 0 7 1Zm0 0V5a3 3 0 0 1 5.8-1A4 4 0 0 1 21 10a4 4 0 0 1-2 7 4 4 0 0 1-7 1Z"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  collapse: '<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
};
export const icon = (name) => `<svg class="prep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
