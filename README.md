[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/wrojasa/badge.svg)](https://hub.xerj.org/contributors/wrojasa)

# DBML ER Diagrams for Visual Studio Code

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/wrojasa.vscode-dbml-erd?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=wrojasa.vscode-dbml-erd)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/wrojasa.vscode-dbml-erd)](https://marketplace.visualstudio.com/items?itemName=wrojasa.vscode-dbml-erd)
[![Open VSX](https://img.shields.io/open-vsx/v/wrojasa/vscode-dbml-erd?label=Open%20VSX)](https://open-vsx.org/extension/wrojasa/vscode-dbml-erd)
[![CI](https://github.com/wrojasa/vscode-dbml-erd/actions/workflows/ci.yml/badge.svg)](https://github.com/wrojasa/vscode-dbml-erd/actions/workflows/ci.yml)

Renders `.dbml` files and ` ```dbml ` code blocks in Markdown as **interactive entity-relationship diagrams**, with **orthogonal, dbdiagram.io-style routing** (right-angle lines), crow's-foot notation and direct editing on the canvas. Every change you make from the diagram (rename, move, color, cardinality, delete, areas…) is written back into the text, which stays the single source of truth.

This is the VS Code port of the Obsidian plugin [DBML ER Diagrams](https://github.com/wrojasa/obsidian-dbml-erd). Both read and write the same DBML subset and the same layout annotations, so a block can move between an Obsidian note and VS Code without losing its layout.

- **Author:** Wilmar Rojas Avendaño · **License:** MIT · **Issues:** [GitHub](https://github.com/wrojasa/vscode-dbml-erd/issues)
- **Minimum VS Code version:** 1.90

---

## How to open a diagram

- **`.dbml` file**: click the diagram icon in the editor title bar, or run **DBML ERD: Open ER Diagram to the Side** from the Command Palette. You can also right-click the file in the Explorer, choose **Open With…** and pick **DBML ER Diagram**: the diagram then opens as the editor itself.
- **Markdown**: put the cursor inside a ` ```dbml ` block and run the same command. Each block gets its own preview panel; if the cursor is outside any block, the first ` ```dbml ` block of the file is used.

The preview keeps following the text as you type. While the text is half-written (for example an unclosed `{`), the last valid diagram stays on screen with a notice at the bottom.

## What it does

### Render and layout

- Automatic layout with [elkjs](https://github.com/kieler/elkjs) (`elk.layered`) that minimizes crossings.
- **Orthogonal (90°) routing** in dbdiagram.io style, with rounded corners; lines re-route live as you move tables.
- Layout cache by structure: saving positions does not recompute the layout nor cause flicker.
- Theme integrated with VS Code colors (light, dark and high contrast).

### Notation

- **One symbol per endpoint for cardinality**: crow's foot on the "many" side; on the "one" side, a bar (`│`) if the FK is `not null`, or a circle (`○`) if it is nullable.
- **PK** (🔑) and **FK** (🔗) icons, **`NN`** badge for `not null` columns.
- Per-table header color (text adjusts to white or dark depending on the background).

### Work areas (table groups)

Each DBML `TableGroup name [color: #hex] { table … }` is drawn as an area: a box with a colored header bar and a light background that wraps its tables.

- Drag an area by its header bar to move all its tables; the area grows or shrinks as you drag one of its tables.
- ▾ / ▸ at the left of the header bar (or **Collapse area** / **Expand area** in the area menu) collapses or expands an area. A collapsed area shows its name and table count; relationships to its tables connect to the collapsed box.
- Click the header bar (or a collapsed area) for the area menu: collapse or expand, rename, pick or remove its color, create a new table inside it, or remove the area (its tables are kept).

### Editing on the canvas

Click a table header, a column or a relationship line to open a menu:

- **Table**: collapse to its header or expand again (also with the ▾ / ▸ at the right of the header), rename (references are updated), header color, delete (with confirmation; relationships that reference it are removed), move to an area, to a new area, or out of its area.
- **Column**: rename (updates `table.col` in refs), change type.
- **Relationship**: select it on first click, then change its cardinality (one to many, many to one, one to one, many to many), add, drag and delete route vertices (right-click a vertex), or reset the route.
- **New table**: the table button in the toolbar asks for a name and creates the table, with an `id integer [pk, not null]` column, in the middle of the view.

Dragging a table never changes its area; membership only changes through the menu.

### Canvas

- Pan by dragging the background, zoom with the wheel or the `+` / `−` buttons, `⊡` fits the diagram to the view.
- Text prompts, confirmations and the area picker use VS Code's own input box, dialog and quick pick.

## Layout annotations

The diagram stores its state as comments inside the block, so it survives reloads and travels with the text:

```dbml
// @pos customer 40 120        table position (only for tables you moved)
// @view 30 30 1.000           pan and zoom
// @edge order customer_id customer id 420 140 420 260
//                             hand-edited vertices of a relationship route
// @group sales collapsed      collapsed area
// @table customer collapsed   collapsed table (header only)
```

A `// @size w h` line written by the Obsidian plugin is kept untouched (the VS Code canvas always fills its panel). `// @table` is new in this extension: the Obsidian plugin (0.3.0) keeps the line as a comment and draws the table expanded.

Edits from the diagram are ordinary document edits: the file turns dirty and you save it as usual (`Ctrl+S`), and every change can be undone with `Ctrl+Z`.

## DBML subset

- `Table name { … }` and `Table "schema"."name" { … }`, with `as alias`.
- Columns: `name type [settings]`, with `pk` / `primary key`, `not null`, `null`, `unique`, `note: '…'`, `ref: > other.col` (inline), and `headercolor: #hex` on the table.
- Relationships: `Ref: a.col > b.col`, `Ref name: …`, `Ref { … }`, and the short form `a.col > b.col`; operators `>`, `<`, `<>`, `-`.
- `TableGroup name [color: #hex] { table … }`.
- `enum`, `Project`, `Note`, `indexes`, `//` and `/* */` comments are accepted and ignored.

The same subset is produced by the Claude Code skill `sql-to-dbml`, which converts `CREATE TABLE` scripts to DBML.

## Settings

- `dbmlErd.language`: `auto` (follows the VS Code display language: Spanish when it starts with `es`, English otherwise), `en` or `es`. Applies to menus, dialogs and notices.

## Development

```bash
npm install
npm run dev        # builds dist/extension.js and dist/webview.js (with inline source maps)
npm run watch      # same, rebuilding on change
npm test           # parser, layout, areas, edits, ops and a jsdom smoke test of the webview
npm run test:vscode  # integration test inside the installed VS Code (opens a window for a few seconds)
npm run typecheck
npm run build      # minified build
npm run package    # .vsix with vsce
```

Press `F5` in VS Code to launch an Extension Development Host with the `samples/` folder open.

### Project layout

```
src/extension.ts        activate: custom editor, preview command, language setting
src/session.ts          document <-> webview: block location, updates, edits, dialogs
src/webview/main.ts     webview entry: parse, layout cache, mounts the Diagram
src/webview/diagram.ts  SVG diagram: drawing, routing, drag, menus (ported from the plugin)
src/webview/menu.ts     HTML context menu
src/webview/host.ts     Host interface and the postMessage bridge
src/shared/             parser, layout, areas, edits, ops, i18n (no DOM, no VS Code)
media/styles.css        theme with --vscode-* variables
syntaxes/               TextMate grammar for .dbml and for ```dbml blocks in Markdown
docs/specs/             design notes (Spanish)
```

The diagram never edits text by itself: it sends an operation (`src/shared/ops.ts`) to the extension host, which reads the document at that moment, applies the pure mutation and replaces only the lines that changed. This mirrors `vault.process` in the Obsidian plugin and means a diagram action never overwrites text you typed meanwhile.
