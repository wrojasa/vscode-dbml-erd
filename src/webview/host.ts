// Interfaz `Host`: todo lo que el diagrama necesita de su entorno y no es SVG.
// La implementación de VS Code conversa con el extension host por postMessage;
// el plugin de Obsidian puede implementarla con Menu, Modal, Notice y vault.
import type { EditOp } from "../shared/ops";
import type { MenuItem } from "./menu";
import { showMenu } from "./menu";

export type { MenuItem };

export interface Host {
  menu(items: MenuItem[], at: { x: number; y: number }): void;
  prompt(title: string, initial: string, kind?: "name" | "type" | "color"): Promise<string | undefined>;
  confirm(title: string, body: string, okLabel: string): Promise<boolean>;
  // índice elegido en `items`, o undefined si se canceló
  pick(title: string, items: string[]): Promise<number | undefined>;
  notice(message: string, level?: "info" | "error"): void;
  // aplica la operación sobre el documento; `failMsg` se muestra si no se pudo
  edit(op: EditOp, failMsg?: string): void;
}

// ---- mensajes host <-> webview ----
export type ToWebview =
  | { type: "init"; text: string; lang: string; title: string }
  | { type: "update"; text: string }
  | { type: "config"; lang: string }
  | { type: "missing"; message: string } // el bloque ya no está en el documento
  | { type: "promptResult"; id: number; value?: string }
  | { type: "confirmResult"; id: number; ok: boolean }
  | { type: "pickResult"; id: number; index?: number };

export type ToHost =
  | { type: "ready" }
  | { type: "edit"; op: EditOp; failMsg?: string }
  | { type: "prompt"; id: number; title: string; initial: string; kind?: "name" | "type" | "color" }
  | { type: "confirm"; id: number; title: string; body: string; okLabel: string }
  | { type: "pick"; id: number; title: string; items: string[] }
  | { type: "notice"; level: "info" | "error"; message: string };

interface VsCodeApi {
  postMessage(msg: ToHost): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export class VsCodeHost implements Host {
  readonly api: VsCodeApi = acquireVsCodeApi();
  private seq = 0;
  private pending = new Map<number, (msg: ToWebview) => void>();

  post(msg: ToHost) {
    this.api.postMessage(msg);
  }

  // entrega al Host las respuestas a prompt/confirm/pick; true si era suya
  handle(msg: ToWebview): boolean {
    if (msg.type !== "promptResult" && msg.type !== "confirmResult" && msg.type !== "pickResult")
      return false;
    const cb = this.pending.get(msg.id);
    if (cb) {
      this.pending.delete(msg.id);
      cb(msg);
    }
    return true;
  }

  private ask<T>(build: (id: number) => ToHost, pick: (msg: ToWebview) => T): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve) => {
      this.pending.set(id, (msg) => resolve(pick(msg)));
      this.post(build(id));
    });
  }

  menu(items: MenuItem[], at: { x: number; y: number }) {
    showMenu(items, at);
  }
  prompt(title: string, initial: string, kind?: "name" | "type" | "color") {
    return this.ask<string | undefined>(
      (id) => ({ type: "prompt", id, title, initial, kind }),
      (m) => (m.type === "promptResult" ? m.value : undefined)
    );
  }
  confirm(title: string, body: string, okLabel: string) {
    return this.ask<boolean>(
      (id) => ({ type: "confirm", id, title, body, okLabel }),
      (m) => m.type === "confirmResult" && m.ok
    );
  }
  pick(title: string, items: string[]) {
    return this.ask<number | undefined>(
      (id) => ({ type: "pick", id, title, items }),
      (m) => (m.type === "pickResult" ? m.index : undefined)
    );
  }
  notice(message: string, level: "info" | "error" = "info") {
    this.post({ type: "notice", level, message });
  }
  edit(op: EditOp, failMsg?: string) {
    this.post({ type: "edit", op, failMsg });
  }
}
