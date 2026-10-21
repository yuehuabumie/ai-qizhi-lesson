import CSS_TEXT from "./styles.css";
export function ensureStyle() {
  if (document.getElementById("prep-studio-style")) return;
  const style = document.createElement("style");
  style.id = "prep-studio-style";
  style.textContent = CSS_TEXT;
  document.head.append(style);
}
