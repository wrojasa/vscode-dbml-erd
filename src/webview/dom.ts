// Helpers mínimos de DOM que reemplazan a createDiv/createEl/empty/setText de
// Obsidian dentro del webview.
export const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  parent?: Element
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) for (const c of cls.split(" ")) if (c) e.classList.add(c);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export function clear(e: Element) {
  while (e.firstChild) e.removeChild(e.firstChild);
}

// Ícono "tabla" (trazo, 16 px) para el botón de nueva tabla; inline, sin fuente
// de íconos ni CSP extra.
export function tableIcon(): SVGSVGElement {
  const s = svgEl("svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "16");
  s.setAttribute("height", "16");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  const paths = ["M12 3v18", "M3 9h18", "M3 15h18"];
  const r = svgEl("rect");
  r.setAttribute("x", "3");
  r.setAttribute("y", "3");
  r.setAttribute("width", "18");
  r.setAttribute("height", "18");
  r.setAttribute("rx", "2");
  s.appendChild(r);
  for (const d of paths) {
    const p = svgEl("path");
    p.setAttribute("d", d);
    s.appendChild(p);
  }
  return s;
}
