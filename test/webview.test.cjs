// Prueba de humo del webview completo (dist del script empaquetado en
// test/.build/webview.js) dentro de jsdom: render de tablas, áreas y
// relaciones; re-render al cambiar el texto; errores de parseo sin perder el
// diagrama; y el protocolo con el host (prompt, confirm, edit).
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const SCRIPT = readFileSync(join(__dirname, ".build", "webview.js"), "utf8");

const SAMPLE = [
  "Table a {",
  "  id integer [pk, not null]",
  "  b_id integer [ref: > b.id]",
  "}",
  "Table b {",
  "  id integer [pk, not null]",
  "  c_id integer [ref: > c.id]",
  "}",
  "Table c {",
  "  id integer [pk, not null]",
  "}",
  "TableGroup g1 [color: #20479e] {",
  "  a",
  "  b",
  "}",
].join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// los objetos llegan del realm de jsdom: se comparan sin prototipo
const plain = (x) => JSON.parse(JSON.stringify(x));

async function until(fn, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout waiting");
    await sleep(20);
  }
}

function boot() {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => {
    // jsdom no implementa canvas: la medición cae a la estimación por carácter
    if (!/not implemented/i.test(String(e.message))) errors.push(e);
  });
  virtualConsole.on("error", (...a) => errors.push(a));
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    };
  }
  window.eval(SCRIPT);
  const send = (msg) => window.dispatchEvent(new window.MessageEvent("message", { data: msg }));
  const doc = window.document;
  const q = (sel) => doc.querySelectorAll(sel);
  const last = (type) => [...posted].reverse().find((m) => m.type === type);
  return { window, doc, posted, send, q, last, errors };
}

function pointer(window, el, type, x = 10, y = 10) {
  el.dispatchEvent(
    new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 })
  );
}

test("webview: ready, render de tablas/áreas/aristas y re-render por update", async () => {
  const w = boot();
  assert.equal(w.posted[0].type, "ready");
  w.send({ type: "init", text: SAMPLE, lang: "es", title: "ERD: x" });
  await until(() => w.q(".dbml-node").length === 3);
  assert.equal(w.q(".dbml-edge:not(.aggregated)").length, 2);
  assert.equal(w.q(".dbml-area").length, 1);
  assert.equal(w.doc.title, "ERD: x");
  const names = [...w.q(".dbml-head-txt")].map((e) => e.textContent).sort();
  assert.deepEqual(names, ["a", "b", "c"]);

  // update con una tabla renombrada: misma estructura, nuevo nombre
  w.send({ type: "update", text: SAMPLE.replace(/\bc\b/g, "zeta") });
  await until(() => [...w.q(".dbml-head-txt")].some((e) => e.textContent === "zeta"));
  assert.equal(w.q(".dbml-node").length, 3);

  // texto a medio escribir (llave sin cerrar: el parser no ve tablas): se
  // conserva el diagrama y aparece el aviso
  w.send({ type: "update", text: "Table a {\n  id int\n" });
  await until(() => !w.doc.querySelector(".dbml-erd-banner").classList.contains("hidden"));
  assert.equal(w.q(".dbml-node").length, 3, "el último diagrama válido sigue en pantalla");
  assert.ok(w.doc.querySelector(".dbml-erd-banner").classList.contains("error"));
  // vuelve el texto válido: desaparece el aviso
  w.send({ type: "update", text: SAMPLE });
  await until(() => w.doc.querySelector(".dbml-erd-banner").classList.contains("hidden"));
  assert.deepEqual(w.errors, []);
});

test("webview: bloque sin tablas desde el inicio muestra el mensaje", async () => {
  const w = boot();
  w.send({ type: "init", text: "// nada", lang: "es", title: "t" });
  await until(() => w.q(".dbml-erd-message").length === 1);
  assert.equal(w.q(".dbml-node").length, 0);
  assert.equal(w.doc.querySelector(".dbml-erd-message").textContent, "DBML sin tablas.");
  assert.deepEqual(w.errors, []);
});

test("webview: nueva tabla pide nombre al host y emite la op addTable con pins", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE, lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  const btn = [...w.q(".dbml-erd-toolbar button")].find((b) => b.getAttribute("aria-label") === "New table");
  assert.ok(btn, "botón de nueva tabla");
  btn.click();
  const p = await until(() => w.last("prompt"));
  assert.equal(p.kind, "name");
  w.send({ type: "promptResult", id: p.id, value: "nueva" });
  const e = await until(() => w.last("edit"));
  assert.equal(e.op.kind, "addTable");
  assert.equal(e.op.name, "nueva");
  assert.deepEqual(plain(Object.keys(e.op.pins).sort()), ["a", "b", "c", "nueva"]);
  assert.ok(typeof e.failMsg === "string");
  // nombre inválido: aviso, sin edit
  const n = w.posted.length;
  btn.click();
  const p2 = await until(() => w.posted.length > n && w.last("prompt"));
  w.send({ type: "promptResult", id: p2.id, value: "mal nombre" });
  const notice = await until(() => w.posted.slice(n).find((m) => m.type === "notice"));
  assert.equal(notice.level, "error");
  assert.deepEqual(w.errors, []);
});

test("webview: menú de tabla, confirmación de borrado y op deleteTable", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE, lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  const head = w.doc.querySelector(".dbml-node .dbml-head");
  pointer(w.window, head, "pointerdown");
  pointer(w.window, head, "pointerup");
  const menu = await until(() => w.doc.querySelector(".dbml-menu"));
  const labels = [...menu.querySelectorAll(".dbml-menu-label")].map((e) => e.textContent);
  assert.ok(labels.includes("Rename table…"));
  assert.ok(labels.includes("Move to area…"));
  assert.ok(labels.includes("Delete table…"));
  const del = [...menu.querySelectorAll(".dbml-menu-item")].find((e) => e.textContent.includes("Delete table"));
  del.click();
  assert.equal(w.doc.querySelector(".dbml-menu"), null, "el menú se cierra");
  const c = await until(() => w.last("confirm"));
  assert.equal(c.okLabel, "Delete");
  w.send({ type: "confirmResult", id: c.id, ok: true });
  const e = await until(() => w.last("edit"));
  assert.equal(e.op.kind, "deleteTable");
  assert.equal(e.op.name, "a");
  assert.deepEqual(w.errors, []);
});

test("webview: zoom guarda el layout (op layout con @view) tras el debounce", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE + "\n// @view 5 6 1.000", lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  const zoomIn = [...w.q(".dbml-erd-toolbar button")].find((b) => b.textContent === "+");
  zoomIn.click();
  const e = await until(() => w.last("edit"), 3000);
  assert.equal(e.op.kind, "layout");
  assert.ok(Math.abs(e.op.state.view.k - 1.15) < 1e-9);
  assert.deepEqual(plain(e.op.state.pos), {}, "sin tablas movidas no se fija ninguna");
  assert.deepEqual(plain(e.op.state.collapsed), []);
  assert.deepEqual(w.errors, []);
});

test("webview: colapsar un área agrega aristas y persiste @group", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE + "\n// @view 0 0 1.000", lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  const hit = w.doc.querySelector(".dbml-area-toggle-hit");
  pointer(w.window, hit, "pointerdown");
  pointer(w.window, hit, "pointerup");
  await until(() => w.q(".dbml-area-collapsed").length === 1);
  assert.equal(w.q(".dbml-node").length, 1, "solo c queda visible");
  assert.equal(w.q(".dbml-edge.aggregated").length, 1, "b->c agregada al área");
  const e = await until(() => w.last("edit"), 3000);
  assert.equal(e.op.kind, "layout");
  assert.deepEqual(plain(e.op.state.collapsed), ["g1"]);
  assert.deepEqual(w.errors, []);
});

test("webview: colapsar una tabla deja solo el encabezado y persiste @table", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE + "\n// @table b collapsed\n// @view 0 0 1.000", lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  assert.equal(w.q(".dbml-node-collapsed").length, 1, "b viene colapsada del texto");
  assert.equal(w.q(".dbml-node-collapsed .dbml-row").length, 0, "sin filas");
  const edgeD = () => [...w.q(".dbml-edge")].map((p) => p.getAttribute("d")).join("|");
  const before = edgeD();
  // ▾ de la primera tabla (a)
  const hit = w.doc.querySelector(".dbml-node .dbml-node-toggle-hit");
  pointer(w.window, hit, "pointerdown");
  pointer(w.window, hit, "pointerup");
  await until(() => w.q(".dbml-node-collapsed").length === 2);
  assert.notEqual(edgeD(), before, "la arista de a se rutea al encabezado sin mover la tabla");
  assert.equal(w.doc.querySelector(".dbml-menu"), null, "el toque en ▾ no abre menú");
  assert.equal(w.q(".dbml-edge").length, 2, "las aristas siguen");
  const e = await until(() => w.last("edit"), 3000);
  assert.equal(e.op.kind, "layout");
  assert.deepEqual(plain(e.op.state.collapsedTables), ["a", "b"]);
  // menú de una tabla colapsada ofrece expandir
  const head = w.doc.querySelector(".dbml-node-collapsed .dbml-head");
  pointer(w.window, head, "pointerdown");
  pointer(w.window, head, "pointerup");
  const menu = await until(() => w.doc.querySelector(".dbml-menu"));
  const labels = [...menu.querySelectorAll(".dbml-menu-label")].map((x) => x.textContent);
  assert.ok(labels.includes("Expand table"));
  assert.deepEqual(w.errors, []);
});

test("webview: un update durante un arrastre espera a soltar", async () => {
  const w = boot();
  w.send({ type: "init", text: SAMPLE, lang: "en", title: "t" });
  await until(() => w.q(".dbml-node").length === 3);
  const node = w.doc.querySelector(".dbml-node");
  pointer(w.window, node, "pointerdown", 10, 10);
  pointer(w.window, node, "pointermove", 60, 60);
  w.send({ type: "update", text: SAMPLE.replace(/\bc\b/g, "zeta") });
  await sleep(100);
  assert.ok(![...w.q(".dbml-head-txt")].some((e) => e.textContent === "zeta"), "aún no se re-renderiza");
  pointer(w.window, node, "pointerup", 60, 60);
  await until(() => [...w.q(".dbml-head-txt")].some((e) => e.textContent === "zeta"));
  assert.deepEqual(w.errors, []);
});
