// Pruebas de src/shared/ops.ts: operaciones serializables que el host aplica
// sobre el documento, localización de fences y diff mínimo por líneas.
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("./.build/ops.cjs");
const {
  parseDBML,
  parsePositions,
  parseView,
  parseEdges,
  parseGroupState,
  parseTableState,
} = require("./.build/parser.cjs");

const DBML = [
  "Table a {",
  "  id integer [pk, not null]",
  "  b_id integer [ref: > b.id]",
  "}",
  "",
  "Table b {",
  "  id integer [pk, not null]",
  "}",
  "",
  "TableGroup g1 [color: #20479e] {",
  "  a",
  "}",
  "// @pos a 10 20",
  "// @view 1 2 1.000",
  "// @size 800 600",
];

function fenced(body) {
  return ["# título", "", "```dbml", ...body, "```", "", "después"];
}
function bodyOf(lines) {
  return lines.slice(3, lines.indexOf("```", 3));
}

test("ops sobre un .dbml (sin cercas): rename, delete, column, type, ref, color", () => {
  let l = DBML.slice();
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "renameTable", oldName: "a", newName: "alpha" }));
  assert.ok(l.some((x) => /^Table alpha \{/.test(x)));
  assert.ok(l.some((x) => /ref: > b\.id/.test(x)));
  assert.ok(l.some((x) => /^\/\/ @pos alpha 10 20/.test(x)), "@pos renombrado");
  assert.ok(l.some((x) => /^\s*alpha\s*$/.test(x)), "miembro del área renombrado");

  l = DBML.slice();
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "renameColumn", table: "a", oldCol: "b_id", newCol: "bref" }));
  assert.ok(l.some((x) => /^\s*bref integer/.test(x)));
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "setColType", table: "a", col: "bref", type: "bigint" }));
  assert.ok(l.some((x) => /^\s*bref bigint/.test(x)));
  assert.ok(
    O.applyEditOp(l, 0, l.length - 1, {
      kind: "setRefOp",
      ref: { from: "a", fromCol: "bref", to: "b", toCol: "id" },
      op: "-",
    })
  );
  assert.ok(l.some((x) => /ref: - b\.id/.test(x)));
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "setHeaderColor", table: "b", color: "#c62828" }));
  assert.ok(l.some((x) => /^Table b \[headercolor: #c62828\]/i.test(x)));
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "setHeaderColor", table: "b", color: null }));
  assert.ok(l.some((x) => /^Table b \{/.test(x)));
  assert.equal(O.applyEditOp(l, 0, l.length - 1, { kind: "setHeaderColor", table: "zzz", color: "#fff" }), false);

  l = DBML.slice();
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "deleteTable", name: "a" }));
  assert.ok(!l.some((x) => /^Table a \{/.test(x)));
  assert.ok(!l.some((x) => /@pos a /.test(x)));
  assert.ok(!l.some((x) => /TableGroup g1/.test(x)), "área vaciada se elimina");
});

test("ops estructurales fijan la posición de todas las tablas (pins)", () => {
  const pins = { a: { x: 1, y: 2 }, b: { x: 300.4, y: 40 } };
  let l = fenced(DBML);
  const end = l.indexOf("```", 3);
  assert.ok(O.applyEditOp(l, 2, end, { kind: "addTable", name: "c", area: "g1", pins: { ...pins, c: { x: 5, y: 6 } } }));
  const m = parseDBML(bodyOf(l).join("\n"));
  assert.deepEqual(m.tables.map((t) => t.name).sort(), ["a", "b", "c"]);
  assert.ok(m.groups.find((g) => g.name === "g1").tables.includes("c"));
  const pos = parsePositions(bodyOf(l).join("\n"));
  assert.deepEqual(pos, { a: { x: 1, y: 2 }, b: { x: 300, y: 40 }, c: { x: 5, y: 6 } });
  assert.equal(l[l.length - 1], "después", "el texto fuera del bloque no se toca");
  assert.equal(l.filter((x) => /^```/.test(x)).length, 2);

  l = fenced(DBML);
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "addGroup", name: "g2", tables: ["b"], color: "#2e7d32", pins }));
  let mm = parseDBML(bodyOf(l).join("\n"));
  assert.deepEqual(mm.groups.map((g) => g.name), ["g1", "g2"]);
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "moveTableToGroup", table: "b", area: "g1", pins }));
  mm = parseDBML(bodyOf(l).join("\n"));
  assert.deepEqual(mm.groups.map((g) => g.name), ["g1"], "g2 vacía desaparece");
  assert.deepEqual(mm.groups[0].tables, ["a", "b"]);
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "renameGroup", oldName: "g1", newName: "ventas" }));
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "setGroupColor", name: "ventas", color: null }));
  assert.ok(l.some((x) => /^TableGroup ventas \{/.test(x)));
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "removeGroup", name: "ventas", pins }));
  mm = parseDBML(bodyOf(l).join("\n"));
  assert.equal(mm.groups.length, 0);
  assert.equal(mm.tables.length, 2);

  // fallo: no deja rastro
  l = fenced(DBML);
  const before = l.slice();
  assert.equal(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "addTable", name: "a", pins }), false);
  assert.deepEqual(l, before);
});

test("op layout: reescribe @pos/@edge/@group/@view y conserva @size si no se da", () => {
  const state = {
    pos: { b: { x: 99.6, y: -3.2 } },
    edges: [{ from: "a", fromCol: "b_id", to: "b", toCol: "id", pts: [{ x: 1, y: 2 }, { x: 3.7, y: 4 }] }],
    collapsed: ["g1"],
    collapsedTables: ["b"],
    view: { x: 10.4, y: 20, k: 0.75 },
  };
  // con cercas
  let l = fenced(DBML);
  assert.ok(O.applyEditOp(l, 2, l.indexOf("```", 3), { kind: "layout", state }));
  let body = bodyOf(l).join("\n");
  assert.deepEqual(parsePositions(body), { b: { x: 100, y: -3 } }, "solo las tablas del estado");
  assert.deepEqual(parseView(body), { x: 10, y: 20, k: 0.75 });
  assert.deepEqual(parseEdges(body), { "a.b_id->b.id": [{ x: 1, y: 2 }, { x: 4, y: 4 }] });
  assert.deepEqual([...parseGroupState(body)], ["g1"]);
  assert.deepEqual([...parseTableState(body)], ["b"]);
  assert.ok(body.includes("// @size 800 600"), "@size previo conservado");
  assert.equal(l[0], "# título");
  assert.equal(l[l.length - 1], "después");
  assert.equal(l.filter((x) => /^```/.test(x)).length, 2);
  // sin cercas y con size explícito
  l = DBML.slice();
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "layout", state: { ...state, size: { w: 1, h: 2 } } }));
  body = l.join("\n");
  assert.ok(body.includes("// @size 1 2"));
  assert.ok(!body.includes("// @size 800 600"));
  // idempotente: aplicar el mismo estado otra vez no cambia nada
  const again = l.slice();
  O.applyEditOp(again, 0, again.length - 1, { kind: "layout", state: { ...state, size: { w: 1, h: 2 } } });
  assert.deepEqual(again, l);
  assert.equal(O.lineDiff(l, again), null);
});

test("@table collapsed: rename lo renombra, delete lo elimina, layout lo reescribe", () => {
  let l = [...DBML, "// @table a collapsed", "// @table b collapsed"];
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "renameTable", oldName: "a", newName: "alpha" }));
  assert.deepEqual([...parseTableState(l.join("\n"))], ["alpha", "b"]);
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "deleteTable", name: "alpha" }));
  assert.deepEqual([...parseTableState(l.join("\n"))], ["b"]);
  assert.ok(!l.some((x) => /@table alpha/.test(x)));
  // layout sin collapsedTables (estado antiguo) borra las líneas @table
  assert.ok(O.applyEditOp(l, 0, l.length - 1, { kind: "layout", state: { pos: {}, edges: [], collapsed: [], view: { x: 0, y: 0, k: 1 } } }));
  assert.deepEqual([...parseTableState(l.join("\n"))], []);
});

test("op layout con CRLF conserva el fin de línea", () => {
  const l = DBML.map((x) => x + "\r");
  assert.ok(
    O.applyEditOp(l, 0, l.length - 1, {
      kind: "layout",
      state: { pos: {}, edges: [], collapsed: [], view: { x: 0, y: 0, k: 1 } },
    })
  );
  assert.ok(l.every((x) => x.endsWith("\r")), l.filter((x) => !x.endsWith("\r")).join("|"));
  assert.ok(l.some((x) => x === "// @view 0 0 1.000\r"));
});

test("fences: localizar, listar, cerca bajo el cursor", () => {
  const lines = [
    "intro",
    "```js",
    "const x = 1;",
    "```",
    "",
    "```dbml",
    "Table a { id int }",
    "```",
    "texto",
    "~~~DBML",
    "Table b { id int }",
    "~~~",
  ];
  assert.deepEqual(O.dbmlFences(lines), [
    [5, 7],
    [9, 11],
  ]);
  assert.deepEqual(O.fenceAt(lines, 6), [5, 7]);
  assert.deepEqual(O.fenceAt(lines, 11), [9, 11]);
  assert.equal(O.fenceAt(lines, 2), null);
  assert.equal(O.locateDbmlFence(lines, 4), 5);
  assert.equal(O.locateDbmlFence(lines, 8), 9, "empate: hacia abajo si arriba no hay");
  assert.equal(O.locateDbmlFence(lines, 7), 5);
  assert.equal(O.locateDbmlFence(["a", "b"], 0), null);
  assert.deepEqual(O.blockRange(lines, 5), [5, 7]);
  assert.equal(O.blockRange(lines, 6), null);
});

test("lineDiff: prefijo y sufijo comunes fuera", () => {
  assert.deepEqual(O.lineDiff(["a", "b", "c"], ["a", "x", "c"]), { start: 1, delCount: 1, ins: ["x"] });
  assert.deepEqual(O.lineDiff(["a", "b"], ["a", "b", "c"]), { start: 2, delCount: 0, ins: ["c"] });
  assert.deepEqual(O.lineDiff(["a", ""], ["a", "b", ""]), { start: 1, delCount: 0, ins: ["b"] });
  assert.deepEqual(O.lineDiff(["a", "b", "c"], ["a", "c"]), { start: 1, delCount: 1, ins: [] });
  assert.deepEqual(O.lineDiff(["a", "b"], ["b"]), { start: 0, delCount: 1, ins: [] });
  assert.deepEqual(O.lineDiff([], ["a"]), { start: 0, delCount: 0, ins: ["a"] });
  assert.equal(O.lineDiff(["a"], ["a"]), null);
  // líneas repetidas: el sufijo no se come el prefijo
  assert.deepEqual(O.lineDiff(["x", "x"], ["x", "x", "x"]), { start: 2, delCount: 0, ins: ["x"] });
});
