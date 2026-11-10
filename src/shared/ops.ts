// Operaciones de edición del bloque dbml como datos serializables. El webview
// las describe (no toca el texto) y el extension host las aplica sobre el
// documento recién leído, igual que `vault.process` en Obsidian: así una
// escritura nunca pisa lo que el usuario tecleó mientras el diagrama estaba
// desactualizado. Sin DOM ni VS Code: se prueba en Node.
import {
  deleteTableInBlock,
  renameColumnInBlock,
  renameTableInBlock,
  setColumnTypeInBlock,
  setHeaderColorInLine,
  setRefOpInBlock,
} from "./parser";
import {
  addGroupInBlock,
  addTableInBlock,
  moveTableToGroupInBlock,
  removeGroupInBlock,
  renameGroupInBlock,
  setGroupColorInBlock,
  setPositionsInBlock,
} from "./edits";

export interface Pt {
  x: number;
  y: number;
}
export type Pins = Record<string, Pt>;

export interface RefKey {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
}

// Estado visual que el diagrama persiste como comentarios `// @…`.
export interface LayoutState {
  pos: Pins; // solo tablas movidas por el usuario
  edges: (RefKey & { pts: Pt[] })[]; // waypoints intermedios de rutas manuales
  collapsed: string[]; // áreas colapsadas
  collapsedTables?: string[]; // tablas colapsadas (solo encabezado)
  view: { x: number; y: number; k: number };
  size?: { w: number; h: number }; // sin valor: se conserva el @size existente
}

export type EditOp =
  | { kind: "renameTable"; oldName: string; newName: string }
  | { kind: "deleteTable"; name: string }
  | { kind: "renameColumn"; table: string; oldCol: string; newCol: string }
  | { kind: "setColType"; table: string; col: string; type: string }
  | { kind: "setRefOp"; ref: RefKey; op: string }
  | { kind: "setHeaderColor"; table: string; color: string | null }
  | { kind: "renameGroup"; oldName: string; newName: string }
  | { kind: "setGroupColor"; name: string; color: string | null }
  // cambios estructurales: fijan la posición de todas las tablas (`pins`) en
  // la misma escritura para que nada salte al recalcular el layout
  | { kind: "removeGroup"; name: string; pins: Pins }
  | { kind: "addTable"; name: string; area?: string; pins: Pins }
  | { kind: "moveTableToGroup"; table: string; area: string | null; pins: Pins }
  | { kind: "addGroup"; name: string; tables: string[]; color?: string; pins: Pins }
  | { kind: "layout"; state: LayoutState };

export const FENCE_RE = /^\s*(```|~~~)/;
export const DBML_FENCE_RE = /^\s*(```|~~~)\s*dbml\b/i;
const ANNOTATION_RE = /^\s*\/\/\s*@(pos|view|size|edge|group|table)\b/;

export function isFence(line: string | undefined): boolean {
  return !!line && FENCE_RE.test(line);
}

// Valida que `lineStart` sea una cerca y localiza la de cierre escaneando hacia
// adelante (robusto a que el bloque haya crecido). Devuelve [open, close].
export function blockRange(lines: string[], lineStart: number): [number, number] | null {
  if (!isFence(lines[lineStart])) return null;
  for (let i = lineStart + 1; i < lines.length; i++) if (isFence(lines[i])) return [lineStart, i];
  return null;
}

// Cerca de apertura ```dbml más cercana a `hint` (hacia arriba o abajo).
export function locateDbmlFence(lines: string[], hint: number): number | null {
  const h = Math.max(0, Math.min(hint, lines.length - 1));
  for (let d = 0; d < lines.length; d++) {
    const up = h - d;
    const down = h + d;
    if (up >= 0 && DBML_FENCE_RE.test(lines[up])) return up;
    if (down < lines.length && down !== up && DBML_FENCE_RE.test(lines[down])) return down;
  }
  return null;
}

// Todas las cercas ```dbml del documento como [open, close].
export function dbmlFences(lines: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isFence(lines[i])) continue;
    const r = blockRange(lines, i);
    if (!r) break;
    if (DBML_FENCE_RE.test(lines[i])) out.push(r);
    i = r[1];
  }
  return out;
}

// Cerca ```dbml que contiene la línea `line` (cursor), o null.
export function fenceAt(lines: string[], line: number): [number, number] | null {
  for (const r of dbmlFences(lines)) if (line >= r[0] && line <= r[1]) return r;
  return null;
}

// Aplica la operación sobre `lines` entre `start` y `end` (cercas incluidas si
// las hay). Devuelve false si no se pudo; entonces `lines` queda intacto.
export function applyEditOp(lines: string[], start: number, end: number, op: EditOp): boolean {
  switch (op.kind) {
    case "renameTable":
      return renameTableInBlock(lines, start, end, op.oldName, op.newName);
    case "deleteTable":
      return deleteTableInBlock(lines, start, end, op.name);
    case "renameColumn":
      return renameColumnInBlock(lines, start, end, op.table, op.oldCol, op.newCol);
    case "setColType":
      return setColumnTypeInBlock(lines, start, end, op.table, op.col, op.type);
    case "setRefOp":
      return setRefOpInBlock(lines, start, end, op.ref, op.op);
    case "setHeaderColor":
      for (let i = start; i <= end && i < lines.length; i++) {
        const updated = setHeaderColorInLine(lines[i], op.table, op.color);
        if (updated !== null) {
          lines[i] = updated;
          return true;
        }
      }
      return false;
    case "renameGroup":
      return renameGroupInBlock(lines, start, end, op.oldName, op.newName);
    case "setGroupColor":
      return setGroupColorInBlock(lines, start, end, op.name, op.color);
    case "removeGroup":
      return withPins(lines, start, end, op.pins, (l, s, e) => removeGroupInBlock(l, s, e, op.name));
    case "addTable":
      return withPins(lines, start, end, op.pins, (l, s, e) => {
        const before = l.length;
        if (!addTableInBlock(l, s, e, op.name)) return false;
        return op.area
          ? moveTableToGroupInBlock(l, s, e + (l.length - before), op.name, op.area)
          : true;
      });
    case "moveTableToGroup":
      return withPins(lines, start, end, op.pins, (l, s, e) =>
        moveTableToGroupInBlock(l, s, e, op.table, op.area)
      );
    case "addGroup":
      return withPins(lines, start, end, op.pins, (l, s, e) =>
        addGroupInBlock(l, s, e, op.name, op.tables, op.color)
      );
    case "layout":
      return applyLayout(lines, start, end, op.state);
  }
  return false;
}

// Cambio estructural + fijar posiciones en la misma escritura. Si la mutación
// falla, restaura `lines`.
function withPins(
  lines: string[],
  start: number,
  end: number,
  pins: Pins,
  mutate: (l: string[], s: number, e: number) => boolean
): boolean {
  const backup = lines.slice();
  const before = lines.length;
  if (!mutate(lines, start, end)) {
    lines.splice(0, lines.length, ...backup);
    return false;
  }
  return setPositionsInBlock(lines, start, end + (lines.length - before), pins);
}

// Reescribe las anotaciones `@pos/@view/@size/@edge/@group/@table` del bloque con el
// estado dado, dejando el resto del cuerpo intacto. Sin `size`, conserva la
// línea `@size` que hubiera (la escribe Obsidian, donde el lienzo se
// redimensiona; en VS Code el lienzo ocupa todo el panel).
function applyLayout(lines: string[], start: number, end: number, st: LayoutState): boolean {
  const last = Math.min(end, lines.length - 1);
  if (last < start) return false;
  const fenced = isFence(lines[start]);
  const bodyStart = fenced ? start + 1 : start;
  const bodyEnd = fenced && isFence(lines[last]) && last > start ? last - 1 : last;
  const cr = (lines[start] ?? "").endsWith("\r") ? "\r" : "";
  const strip = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  const old = lines.slice(bodyStart, bodyEnd + 1).map(strip);
  const body = old.filter((l) => !ANNOTATION_RE.test(l));
  const posLines = Object.entries(st.pos)
    .filter(([, p]) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(([t, p]) => `// @pos ${t} ${Math.round(p.x)} ${Math.round(p.y)}`);
  const edgeLines = st.edges
    .filter((e) => e.pts.length)
    .map(
      (e) =>
        `// @edge ${e.from} ${e.fromCol} ${e.to} ${e.toCol} ` +
        e.pts.map((p) => `${Math.round(p.x)} ${Math.round(p.y)}`).join(" ")
    );
  const groupLines = st.collapsed.map((g) => `// @group ${g} collapsed`);
  const tableLines = (st.collapsedTables ?? []).map((t) => `// @table ${t} collapsed`);
  const viewLine = `// @view ${Math.round(st.view.x)} ${Math.round(st.view.y)} ${st.view.k.toFixed(3)}`;
  const prevSize = old.find((l) => /^\s*\/\/\s*@size\b/.test(l));
  const sizeLines = st.size
    ? [`// @size ${st.size.w} ${st.size.h}`]
    : prevSize !== undefined
      ? [prevSize]
      : [];
  const next = [...body, ...posLines, ...edgeLines, ...groupLines, ...tableLines, viewLine, ...sizeLines];
  lines.splice(bodyStart, bodyEnd - bodyStart + 1, ...next.map((l) => l + cr));
  return true;
}

// Diferencia mínima por líneas entre dos versiones: prefijo y sufijo comunes
// fuera, se reemplaza solo el tramo central. Devuelve null si son iguales.
export interface LineDiff {
  start: number; // primera línea reemplazada (en `before`)
  delCount: number; // líneas de `before` que se reemplazan
  ins: string[]; // líneas que entran en su lugar
}
export function lineDiff(before: string[], after: string[]): LineDiff | null {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const delCount = before.length - p - s;
  const ins = after.slice(p, after.length - s);
  if (delCount === 0 && ins.length === 0) return null;
  return { start: p, delCount, ins };
}
