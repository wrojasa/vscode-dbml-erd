// Dos bundles: el extension host (Node, cjs, `vscode` externo) y el script del
// webview (navegador, iife, con elkjs incluido). `watch` deja ambos observando.
import esbuild from "esbuild";

const prod = process.argv.includes("production");
const watch = process.argv.includes("watch");

const common = {
  bundle: true,
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
};

const host = {
  ...common,
  entryPoints: ["src/extension.ts"],
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  outfile: "dist/extension.js",
};

const webview = {
  ...common,
  entryPoints: ["src/webview/main.ts"],
  platform: "browser",
  format: "iife",
  target: "es2020",
  outfile: "dist/webview.js",
};

if (watch) {
  const [h, w] = await Promise.all([esbuild.context(host), esbuild.context(webview)]);
  await Promise.all([h.watch(), w.watch()]);
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
}
