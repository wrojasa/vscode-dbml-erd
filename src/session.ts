// Una sesión une un documento (archivo .dbml, o un fence ```dbml dentro de un
// Markdown) con un webview que lo dibuja. Manda el texto del bloque al
// webview, reenvía los cambios del documento, aplica las operaciones de
// edición que pide el diagrama con WorkspaceEdit y atiende sus diálogos con la
// API nativa de VS Code.
import * as vscode from "vscode";
import { t } from "./shared/i18n";
import { NAME_RE, HEX_COLOR_RE } from "./shared/edits";
import { AREA_PALETTE } from "./shared/areas";
import {
  EditOp,
  applyEditOp,
  blockRange,
  lineDiff,
  locateDbmlFence,
  DBML_FENCE_RE,
} from "./shared/ops";
import type { ToHost, ToWebview } from "./webview/host";

export type BlockKind = "dbml" | "md";

const UPDATE_DEBOUNCE_MS = 150;

// colores sugeridos en el selector (paleta de áreas + encabezado por defecto)
const COLOR_CHOICES: { hex: string; key: string }[] = [
  { hex: AREA_PALETTE[0], key: "colorBlue" },
  { hex: AREA_PALETTE[1], key: "colorGreen" },
  { hex: AREA_PALETTE[2], key: "colorRed" },
  { hex: AREA_PALETTE[3], key: "colorPurple" },
  { hex: AREA_PALETTE[4], key: "colorOrange" },
  { hex: AREA_PALETTE[5], key: "colorTeal" },
  { hex: "#5c7fa3", key: "colorSlate" },
  { hex: "#64748b", key: "colorGray" },
];

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export class DiagramSession implements vscode.Disposable {
  static readonly all = new Set<DiagramSession>();

  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private lastSent: string | undefined;
  private fenceLine: number | undefined;
  private relocate = false;
  readonly uri: vscode.Uri;

  constructor(
    private readonly context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
    readonly kind: BlockKind,
    fenceLine?: number,
    private readonly lang: () => string = () => "en"
  ) {
    this.uri = document.uri;
    this.fenceLine = fenceLine;
    DiagramSession.all.add(this);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "dist"),
        vscode.Uri.joinPath(context.extensionUri, "media"),
      ],
    };
    panel.webview.html = this.html(panel.webview);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: ToHost) => void this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocChange(e)),
      panel.onDidDispose(() => this.dispose())
    );
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    DiagramSession.all.delete(this);
  }

  // ¿esta sesión muestra ese bloque? (para reutilizar el panel al reabrir)
  matches(uri: vscode.Uri, kind: BlockKind, fenceLine?: number): boolean {
    return (
      this.uri.toString() === uri.toString() &&
      this.kind === kind &&
      (kind === "dbml" || this.fenceLine === fenceLine)
    );
  }

  post(msg: ToWebview) {
    void this.panel.webview.postMessage(msg);
  }

  // ---- documento ----

  private async doc(): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(this.uri);
  }

  private titleFor(doc: vscode.TextDocument): string {
    const name = doc.uri.path.split("/").pop() ?? doc.uri.toString();
    const line = this.kind === "md" && this.fenceLine !== undefined ? `:${this.fenceLine + 1}` : "";
    return t("previewTitle", { name: name + line });
  }

  // Rango del bloque en el documento (cercas incluidas) y su cuerpo. Para un
  // fence que se movió por ediciones fuera del bloque, se reubica el más
  // cercano a la última línea conocida.
  private block(doc: vscode.TextDocument): { lines: string[]; start: number; end: number; body: string } | null {
    const lines = splitLines(doc.getText());
    if (this.kind === "dbml") {
      return { lines, start: 0, end: lines.length - 1, body: lines.join("\n") };
    }
    let open = this.fenceLine ?? 0;
    if (this.relocate || !DBML_FENCE_RE.test(lines[open] ?? "")) {
      const found = locateDbmlFence(lines, open);
      if (found === null) return null;
      open = found;
      this.fenceLine = found;
      this.relocate = false;
    }
    const r = blockRange(lines, open);
    if (!r) return null;
    return { lines, start: r[0], end: r[1], body: lines.slice(r[0] + 1, r[1]).join("\n") };
  }

  private onDocChange(e: vscode.TextDocumentChangeEvent) {
    if (e.document.uri.toString() !== this.uri.toString()) return;
    if (this.kind === "md" && this.fenceLine !== undefined) {
      // sigue la cerca de apertura cuando el texto de arriba crece o se encoge
      let line = this.fenceLine;
      for (const c of e.contentChanges) {
        const added = (c.text.match(/\n/g) ?? []).length;
        const removed = c.range.end.line - c.range.start.line;
        if (c.range.end.line < this.fenceLine) line += added - removed;
        else if (c.range.start.line <= this.fenceLine) this.relocate = true;
      }
      this.fenceLine = line;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sendUpdate(), UPDATE_DEBOUNCE_MS);
  }

  private async sendInit() {
    const doc = await this.doc();
    const blk = this.block(doc);
    if (!blk) {
      this.post({ type: "missing", message: t("blockNotFound") });
      return;
    }
    this.lastSent = blk.body;
    this.post({ type: "init", text: blk.body, lang: this.lang(), title: this.titleFor(doc) });
  }

  private async sendUpdate() {
    this.timer = undefined;
    if (!this.ready) return;
    let doc: vscode.TextDocument;
    try {
      doc = await this.doc();
    } catch {
      return;
    }
    const blk = this.block(doc);
    if (!blk) {
      this.lastSent = undefined;
      this.post({ type: "missing", message: t("blockNotFound") });
      return;
    }
    if (blk.body === this.lastSent) return;
    this.lastSent = blk.body;
    this.panel.title = this.titleFor(doc);
    this.post({ type: "update", text: blk.body });
  }

  // ---- mensajes del webview ----

  private async onMessage(m: ToHost) {
    switch (m.type) {
      case "ready":
        this.ready = true;
        await this.sendInit();
        return;
      case "edit":
        await this.applyEdit(m.op, m.failMsg);
        return;
      case "notice":
        if (m.level === "error") void vscode.window.showErrorMessage(m.message);
        else void vscode.window.showInformationMessage(m.message);
        return;
      case "prompt": {
        const value = await this.prompt(m.title, m.initial, m.kind);
        this.post({ type: "promptResult", id: m.id, value });
        return;
      }
      case "confirm": {
        const r = await vscode.window.showWarningMessage(m.title, { modal: true, detail: m.body }, m.okLabel);
        this.post({ type: "confirmResult", id: m.id, ok: r === m.okLabel });
        return;
      }
      case "pick": {
        const items = m.items.map((label, i) => ({ label, i }));
        const r = await vscode.window.showQuickPick(items, { title: m.title, placeHolder: m.title });
        this.post({ type: "pickResult", id: m.id, index: r?.i });
        return;
      }
    }
  }

  private async prompt(title: string, initial: string, kind?: "name" | "type" | "color"): Promise<string | undefined> {
    if (kind === "color") return this.pickColor(title, initial);
    const v = await vscode.window.showInputBox({
      title,
      prompt: title,
      value: initial,
      valueSelection: [0, initial.length],
      validateInput:
        kind === "name" ? (s) => (NAME_RE.test(s.trim()) ? undefined : t("invalidName")) : undefined,
    });
    return v?.trim() || undefined;
  }

  private async pickColor(title: string, current: string): Promise<string | undefined> {
    const items: (vscode.QuickPickItem & { hex?: string; custom?: boolean })[] = COLOR_CHOICES.map((c) => ({
      label: t(c.key),
      description: c.hex,
      hex: c.hex,
      picked: c.hex.toLowerCase() === current.toLowerCase(),
    }));
    items.push({ label: t("colorCustom"), custom: true });
    const r = await vscode.window.showQuickPick(items, { title, placeHolder: title });
    if (!r) return undefined;
    if (r.hex) return r.hex;
    const v = await vscode.window.showInputBox({
      title,
      prompt: t("colorPrompt"),
      value: HEX_COLOR_RE.test(current) ? current : "#",
      validateInput: (s) => (HEX_COLOR_RE.test(s.trim()) ? undefined : t("invalidColor")),
    });
    return v?.trim() || undefined;
  }

  // Lee el documento recién antes de mutar (como vault.process en Obsidian) y
  // reemplaza solo las líneas que cambiaron, conservando el EOL del archivo.
  private async applyEdit(op: EditOp, failMsg?: string) {
    let doc: vscode.TextDocument;
    try {
      doc = await this.doc();
    } catch {
      void vscode.window.showErrorMessage(t("locateBlockFail"));
      return;
    }
    const blk = this.block(doc);
    if (!blk) {
      void vscode.window.showErrorMessage(t("locateBlockFail"));
      return;
    }
    const before = blk.lines.slice();
    const lines = blk.lines;
    if (!applyEditOp(lines, blk.start, blk.end, op)) {
      if (failMsg) void vscode.window.showErrorMessage(failMsg);
      return;
    }
    const d = lineDiff(before, lines);
    if (!d) return; // escritura idéntica: no ensucia el documento ni re-renderiza
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const docEnd = doc.lineAt(doc.lineCount - 1).range.end;
    let range: vscode.Range;
    let text: string;
    if (d.start + d.delCount < before.length) {
      range = new vscode.Range(new vscode.Position(d.start, 0), new vscode.Position(d.start + d.delCount, 0));
      text = d.ins.length ? d.ins.join(eol) + eol : "";
    } else if (d.start < before.length) {
      range = new vscode.Range(new vscode.Position(d.start, 0), docEnd);
      text = d.ins.join(eol);
    } else {
      range = new vscode.Range(docEnd, docEnd);
      text = eol + d.ins.join(eol);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) void vscode.window.showErrorMessage(failMsg ?? t("editBlockFail"));
  }

  // ---- HTML del webview ----

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
    const nonce = nonceStr();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>DBML ERD</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function nonceStr(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
