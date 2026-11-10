# Contributing

Issues and pull requests are welcome at <https://github.com/wrojasa/vscode-dbml-erd>.

## Setup

```bash
npm install
npm run dev        # builds dist/
npm test           # unit tests + jsdom smoke test of the webview
npm run test:vscode  # integration test inside VS Code (opens a window)
```

Press `F5` in VS Code to run the extension against the `samples/` folder.

## Rules of the road

- `src/shared/` (parser, layout, areas, edits, ops, i18n) must stay free of DOM and VS Code APIs, and behave exactly like the same modules in the Obsidian plugin [obsidian-dbml-erd](https://github.com/wrojasa/obsidian-dbml-erd): a DBML block with its `// @…` annotations must render the same in both tools.
- The webview never edits text. Add new edits as an `EditOp` in `src/shared/ops.ts`, applied by the extension host.
- Every user-visible string goes through `t()` in `src/shared/i18n.ts`, in English and Spanish.
- Add a test for what you change (`test/*.test.cjs`); `npm test` must pass.
- Keep `CHANGELOG.md` up to date under an "Unreleased" heading; the maintainer sets the version and tags the release.
