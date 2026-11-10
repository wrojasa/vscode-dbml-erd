// Menú contextual HTML propio del webview (reemplaza a `Menu` de Obsidian).
// Se abre en la posición del puntero con clic izquierdo, como en el plugin;
// `contributes.menus["webview/context"]` solo respondería al clic derecho.
import { el } from "./dom";

export interface MenuItem {
  label?: string;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

let open: { root: HTMLElement; close: () => void } | undefined;

export function closeMenu() {
  open?.close();
}

export function showMenu(items: MenuItem[], at: { x: number; y: number }) {
  closeMenu();
  const root = el("div", "dbml-menu", undefined, document.body);
  root.setAttribute("role", "menu");
  const buttons: HTMLElement[] = [];
  for (const it of items) {
    if (it.separator) {
      el("div", "dbml-menu-sep", undefined, root);
      continue;
    }
    const b = el("div", "dbml-menu-item" + (it.danger ? " danger" : ""), undefined, root);
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    el("span", "dbml-menu-check", it.checked ? "✓" : "", b);
    el("span", "dbml-menu-label", it.label ?? "", b);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
      it.onClick?.();
    });
    b.addEventListener("pointerenter", () => b.focus());
    buttons.push(b);
  }

  const onDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const n = buttons.length;
      const next = e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      buttons[next]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      const a = document.activeElement as HTMLElement | null;
      if (a && buttons.includes(a)) {
        e.preventDefault();
        a.click();
      }
    }
  };
  const onBlur = () => close();
  const close = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onBlur);
    root.remove();
    if (open?.root === root) open = undefined;
  };
  // se registran tras el evento que abrió el menú, así ese mismo gesto no lo cierra
  setTimeout(() => {
    if (open?.root !== root) return;
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
  }, 0);
  open = { root, close };

  // posiciona dentro de la ventana
  const pad = 6;
  const r = root.getBoundingClientRect();
  const w = r.width || 200;
  const h = r.height || 40;
  let x = at.x;
  let y = at.y;
  if (x + w + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - w - pad);
  if (y + h + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - h - pad);
  root.style.left = `${Math.round(x)}px`;
  root.style.top = `${Math.round(y)}px`;
  buttons[0]?.focus();
}
