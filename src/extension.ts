// Extension host: registra el editor personalizado para .dbml, el comando de
// vista previa para fences ```dbml en Markdown y el ajuste de idioma.
import * as vscode from "vscode";
import { setLang, Lang } from "./shared/i18n";
import { t } from "./shared/i18n";
import { dbmlFences, fenceAt } from "./shared/ops";
import { DiagramSession, splitLines, BlockKind } from "./session";

const VIEW_TYPE_EDITOR = "dbmlErd.editor";
const VIEW_TYPE_PREVIEW = "dbmlErd.preview";

function resolveLang(): Lang {
  const cfg = vscode.workspace.getConfiguration("dbmlErd").get<string>("language", "auto");
  if (cfg === "en" || cfg === "es") return cfg;
  return vscode.env.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export function activate(context: vscode.ExtensionContext) {
  setLang(resolveLang());
  const lang = () => resolveLang();

  // editor personalizado: "Open With… > DBML ER Diagram" sobre un .dbml
  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, panel) {
      new DiagramSession(context, document, panel, "dbml", undefined, lang);
    },
  };
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE_EDITOR, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    })
  );

  // vista previa al lado: .dbml completo o el fence ```dbml bajo el cursor
  context.subscriptions.push(
    vscode.commands.registerCommand("dbmlErd.openPreview", () => openPreview(context, lang))
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("dbmlErd.language")) return;
      const l = resolveLang();
      setLang(l);
      for (const s of DiagramSession.all) s.post({ type: "config", lang: l });
    })
  );

  context.subscriptions.push({
    dispose() {
      for (const s of [...DiagramSession.all]) s.dispose();
    },
  });

  // API de la extensión: solo para la prueba de integración (test/vscode)
  return { sessions: DiagramSession.all };
}

export function deactivate() {
  for (const s of [...DiagramSession.all]) s.dispose();
}

async function openPreview(context: vscode.ExtensionContext, lang: () => string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(t("notDbmlEditor"));
    return;
  }
  const doc = editor.document;
  let kind: BlockKind;
  let fenceLine: number | undefined;
  if (doc.languageId === "dbml" || doc.uri.path.toLowerCase().endsWith(".dbml")) {
    kind = "dbml";
  } else if (doc.languageId === "markdown") {
    const lines = splitLines(doc.getText());
    const cur = editor.selection.active.line;
    const fence = fenceAt(lines, cur) ?? dbmlFences(lines)[0];
    if (!fence) {
      void vscode.window.showInformationMessage(t("noFenceInDoc"));
      return;
    }
    kind = "md";
    fenceLine = fence[0];
  } else {
    void vscode.window.showInformationMessage(t("notDbmlEditor"));
    return;
  }

  for (const s of DiagramSession.all) {
    if (s.matches(doc.uri, kind, fenceLine)) {
      s.panel.reveal(undefined, true);
      return;
    }
  }

  const name = doc.uri.path.split("/").pop() ?? "dbml";
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE_PREVIEW,
    t("previewTitle", { name }),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "media", "icon-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "media", "icon-dark.svg"),
  };
  new DiagramSession(context, doc, panel, kind, fenceLine, lang);
}
