# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-11-10

First release. Port of the Obsidian plugin DBML ER Diagrams 0.3.0 (commit `3e98d7b`) to a Visual Studio Code extension.

### Added

- **`.dbml` files**: custom editor "DBML ER Diagram" (via *Open With…*) and the command **DBML ERD: Open ER Diagram to the Side**, also available as an icon in the editor title bar.
- **Markdown**: the same command opens a preview for the ` ```dbml ` block under the cursor; each block gets its own panel that follows its fence when the file is edited above it.
- Everything the Obsidian plugin draws and edits: ELK layout with orthogonal routing, crow's-foot notation, PK/FK icons, `NN` badge, header colors, work areas (`TableGroup`) that can be dragged, collapsed, renamed, recolored and removed, new tables from the toolbar or from an area, moving tables between areas, renaming tables and columns, changing types and cardinalities, hand-edited routes, pan, zoom and fit.
- Layout annotations compatible with the plugin (`// @pos`, `// @view`, `// @edge`, `// @group`); an existing `// @size` line is preserved.
- New in this extension: tables can be collapsed to their header (▾ at the right of the header, or the table menu), saved as `// @table name collapsed`; area collapse/expand is also offered in the area menu.
- Edits are applied by the extension host as ordinary document edits (undoable, file turns dirty), replacing only the lines that changed and keeping the file's line endings.
- While the text is half-written, the last valid diagram stays on screen with a notice.
- Language setting `dbmlErd.language` (`auto`, `en`, `es`).
- `dbml` language id with a TextMate grammar, also injected into ` ```dbml ` blocks in Markdown.
- Tests: parser, layout, areas, edits, ops and a jsdom smoke test of the full webview (`npm test`).
