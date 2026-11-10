// Corre dentro del extension host de VS Code (ver run.mjs). Sin Mocha: una
// lista de pasos con assert; el primero que falla aborta con el error.
const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = "condition") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(50);
  }
}
const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
const webviewTabs = (viewType) =>
  tabs().filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(viewType));
const customTabs = (viewType) =>
  tabs().filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === viewType);

// descarta los cambios de los documentos sucios (los samples no se tocan en
// disco) y cierra todo sin diálogos de guardado
async function closeAll() {
  for (const doc of vscode.workspace.textDocuments) {
    if (!doc.isDirty) continue;
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand("workbench.action.files.revert");
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await sleep(200);
}

exports.run = async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "samples/ abierto como carpeta");
  const ext = vscode.extensions.getExtension("wrojasa.vscode-dbml-erd");
  assert.ok(ext, "extensión encontrada");
  const api = await ext.activate();
  assert.ok(api && api.sessions instanceof Set, "API de prueba (sessions)");
  const sessions = api.sessions;

  // 1) .dbml: vista previa al lado -> panel webview y sesión
  const dbmlUri = vscode.Uri.file(path.join(folder.uri.fsPath, "shop.dbml"));
  const dbmlDoc = await vscode.workspace.openTextDocument(dbmlUri);
  await vscode.window.showTextDocument(dbmlDoc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("dbmlErd.openPreview");
  await until(() => webviewTabs("dbmlErd.preview").length === 1, 8000, "preview panel");
  const s1 = await until(() => [...sessions].find((s) => s.kind === "dbml"), 8000, "dbml session");
  assert.equal(s1.uri.toString(), dbmlUri.toString());
  // el webview avisa ready y recibe init
  await until(() => s1.ready === true, 15000, "webview ready");
  // reabrir el comando reutiliza el panel
  await vscode.window.showTextDocument(dbmlDoc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("dbmlErd.openPreview");
  await sleep(300);
  assert.equal(webviewTabs("dbmlErd.preview").length, 1, "un solo panel por bloque");

  // 2) una op de edición aplicada por el host sobre el documento real
  const before = dbmlDoc.getText();
  assert.ok(!/\/\/ @view/.test(before));
  await s1.onMessage({
    type: "edit",
    op: { kind: "layout", state: { pos: { city: { x: 10, y: 20 } }, edges: [], collapsed: ["catalog"], view: { x: 1, y: 2, k: 0.5 } } },
  });
  await until(() => /\/\/ @view 1 2 0\.500/.test(dbmlDoc.getText()), 5000, "@view written");
  const after = dbmlDoc.getText();
  assert.ok(/\/\/ @pos city 10 20/.test(after));
  assert.ok(/\/\/ @group catalog collapsed/.test(after));
  assert.ok(dbmlDoc.isDirty, "el documento queda sucio");
  const eol = dbmlDoc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  assert.ok(after.includes(`// @pos city 10 20${eol}`), "conserva el EOL del archivo");
  // la misma op otra vez no cambia nada
  const v0 = dbmlDoc.version;
  await s1.onMessage({
    type: "edit",
    op: { kind: "layout", state: { pos: { city: { x: 10, y: 20 } }, edges: [], collapsed: ["catalog"], view: { x: 1, y: 2, k: 0.5 } } },
  });
  await sleep(300);
  assert.equal(dbmlDoc.version, v0, "escritura idéntica omitida");
  // rename de tabla con referencias
  await s1.onMessage({ type: "edit", op: { kind: "renameTable", oldName: "city", newName: "town" }, failMsg: "x" });
  await until(() => /Table town \{/.test(dbmlDoc.getText()), 5000, "rename applied");
  assert.ok(/ref: > town\.id/.test(dbmlDoc.getText()));
  assert.ok(/\/\/ @pos town 10 20/.test(dbmlDoc.getText()));
  // deshacer: revierte toda la op en un paso
  await vscode.window.showTextDocument(dbmlDoc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("undo");
  await until(() => /Table city \{/.test(dbmlDoc.getText()), 5000, "undo");

  // 3) editor personalizado para .dbml
  await vscode.commands.executeCommand("vscode.openWith", dbmlUri, "dbmlErd.editor");
  await until(() => customTabs("dbmlErd.editor").length === 1, 8000, "custom editor tab");
  await until(() => [...sessions].filter((s) => s.kind === "dbml").length === 2, 8000, "custom editor session");

  // 4) Markdown: fence bajo el cursor y seguimiento al insertar líneas arriba
  await closeAll();
  await until(() => sessions.size === 0, 5000, "sessions disposed with their panels");
  const mdUri = vscode.Uri.file(path.join(folder.uri.fsPath, "notes.md"));
  const mdDoc = await vscode.workspace.openTextDocument(mdUri);
  const mdLines = mdDoc.getText().split(/\r?\n/);
  const fences = mdLines.map((l, i) => (/^```dbml/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(fences.length, 2, "dos fences dbml en notes.md");
  const ed = await vscode.window.showTextDocument(mdDoc, vscode.ViewColumn.One);
  ed.selection = new vscode.Selection(fences[1] + 1, 0, fences[1] + 1, 0);
  await vscode.commands.executeCommand("dbmlErd.openPreview");
  const s2 = await until(() => [...sessions].find((s) => s.kind === "md"), 8000, "md session");
  assert.equal(s2.fenceLine, fences[1], "sigue el segundo fence");
  // insertar dos líneas al principio: la cerca se desplaza
  const we = new vscode.WorkspaceEdit();
  we.insert(mdUri, new vscode.Position(0, 0), "x\ny\n");
  assert.ok(await vscode.workspace.applyEdit(we));
  await until(() => s2.fenceLine === fences[1] + 2, 5000, "fence line shifted");
  // op sobre el segundo bloque: solo ese bloque cambia
  await until(() => s2.ready === true, 15000, "md webview ready");
  await s2.onMessage({ type: "edit", op: { kind: "renameTable", oldName: "tag", newName: "label" }, failMsg: "x" });
  await until(() => /Table label \{/.test(mdDoc.getText()), 5000, "md rename");
  const txt = mdDoc.getText();
  assert.ok(/ref: > label\.id/.test(txt));
  assert.ok(/Table user \{/.test(txt), "el primer bloque sigue intacto");
  assert.ok(txt.startsWith("x\ny\n") || txt.startsWith("x\r\ny\r\n"));

  await closeAll();
  console.log("integration suite: OK");
};
