// Punto de entrada del webview: recibe el texto del bloque dbml desde el
// extension host, lo parsea, calcula (o reutiliza) el layout ELK y monta el
// Diagram. Equivale a `renderBlock` del plugin de Obsidian; aquí vive el caché
// de layout por estructura y la selección de arista que sobrevive a cada
// re-render (el documento se vuelve a renderizar tras cada escritura).
import {
  parseDBML,
  Model,
  parsePositions,
  parseView,
  parseEdges,
  parseGroupState,
  parseTableState,
} from "../shared/parser";
import { computeLayout, LayoutResult, setMeasureFont } from "../shared/layout";
import { t, setLang, Lang } from "../shared/i18n";
import { Diagram } from "./diagram";
import { VsCodeHost, ToWebview } from "./host";
import { el, clear } from "./dom";
import { closeMenu } from "./menu";

const host = new VsCodeHost();
const app = document.getElementById("app") as HTMLElement;
const wrap = el("div", "dbml-erd-wrap", undefined, app);
const banner = el("div", "dbml-erd-banner hidden", undefined, app);

// El layout ELK depende solo de la estructura DBML, no de las anotaciones de
// disposición; al ignorarlas en la clave, un re-render por guardado reusa el
// layout cacheado y se renderiza sin pausa async (sin parpadeo).
const layoutCache = new Map<string, LayoutResult>();
const CACHE_MAX = 40;
let diagram: Diagram | undefined;
let selected: string | undefined;
let gen = 0;
let lastText: string | undefined;
// updates diferidos mientras hay un gesto de puntero en curso (arrastre):
// reconstruir el SVG en ese momento cortaría el arrastre
let pointers = 0;
let pending: string | undefined;
let pendingTimer = 0;

function setLangFrom(lang: string) {
  setLang(lang as Lang);
}

function showBanner(msg: string, kind: "info" | "error") {
  banner.textContent = msg;
  banner.classList.remove("hidden", "info", "error");
  banner.classList.add(kind);
}
function hideBanner() {
  banner.classList.add("hidden");
}

function unmount() {
  diagram?.dispose();
  diagram = undefined;
  closeMenu();
  clear(wrap);
}

function showMessage(msg: string) {
  unmount();
  el("div", "dbml-erd-message", msg, wrap);
}

function mount(model: Model, layout: LayoutResult, text: string) {
  unmount();
  // clona los nodos del layout cacheado: el Diagram (savedPos y el arrastre)
  // muta las posiciones, y la cache debe quedar prístina para otros render.
  const nodes: LayoutResult["nodes"] = {};
  for (const [k, v] of Object.entries(layout.nodes)) nodes[k] = { ...v };
  diagram = new Diagram(wrap, model, { nodes, edges: layout.edges }, host, {
    savedPos: parsePositions(text),
    view: parseView(text) ?? undefined,
    savedEdges: parseEdges(text),
    collapsed: parseGroupState(text),
    collapsedTables: parseTableState(text),
    selected,
    onSelect: (k) => (selected = k),
  });
}

async function render(text: string) {
  const my = ++gen;
  lastText = text;
  let model: Model;
  try {
    model = parseDBML(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // con un diagrama en pantalla, se conserva el último válido y se avisa
    if (diagram) showBanner(t("parseErrorShort", { msg }), "error");
    else showMessage(t("parseError", { msg }));
    return;
  }
  if (model.tables.length === 0) {
    // mientras se escribe (p. ej. una llave sin cerrar) el parser no ve tablas:
    // se conserva el último diagrama válido con un aviso en vez de vaciarlo
    if (diagram) showBanner(t("noTables"), "error");
    else showMessage(t("noTables"));
    return;
  }
  const key = text.replace(/^[ \t]*\/\/[ \t]*@(pos|view|size|edge|group|table)\b.*$/gm, "").trim();
  let layout = layoutCache.get(key);
  if (!layout) {
    // primer cálculo: placeholder (o aviso sobre el diagrama anterior) mientras ELK trabaja
    if (diagram) showBanner(t("rendering"), "info");
    else showMessage(t("rendering"));
    try {
      layout = await computeLayout(model);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (my !== gen) return;
      if (diagram) showBanner(t("layoutError", { msg }), "error");
      else showMessage(t("layoutError", { msg }));
      return;
    }
    if (my !== gen) return; // llegó otro texto mientras ELK trabajaba
    if (layoutCache.size >= CACHE_MAX) layoutCache.delete(layoutCache.keys().next().value as string);
    layoutCache.set(key, layout);
  }
  hideBanner();
  try {
    mount(model, layout, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showMessage(t("layoutError", { msg }));
  }
}

function scheduleRender(text: string) {
  if (pointers > 0) {
    pending = text;
    // red de seguridad por si se pierde un pointerup
    if (pendingTimer) window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(flushPending, 2000);
    return;
  }
  void render(text);
}
function flushPending() {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = 0;
  pointers = 0;
  if (pending !== undefined) {
    const txt = pending;
    pending = undefined;
    void render(txt);
  }
}
document.addEventListener("pointerdown", () => pointers++, true);
const release = () => {
  pointers = Math.max(0, pointers - 1);
  if (pointers === 0 && pending !== undefined) flushPending();
};
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);

window.addEventListener("message", (ev: MessageEvent<ToWebview>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (host.handle(msg)) return;
  switch (msg.type) {
    case "init":
      setLangFrom(msg.lang);
      document.title = msg.title;
      scheduleRender(msg.text);
      break;
    case "update":
      scheduleRender(msg.text);
      break;
    case "config":
      setLangFrom(msg.lang);
      // los menús leen el idioma al abrirse; el toolbar se rehace con el texto actual
      if (lastText !== undefined) scheduleRender(lastText);
      break;
    case "missing":
      hideBanner();
      showMessage(msg.message);
      break;
  }
});

// mide el texto con la misma fuente que el CSS aplica al SVG
try {
  setMeasureFont(getComputedStyle(document.body).fontFamily);
} catch {
  /* sin DOM completo */
}
host.post({ type: "ready" });
