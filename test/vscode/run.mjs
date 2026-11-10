// Prueba de integración: lanza VS Code (el instalado, si VSCODE_EXE o la ruta
// por defecto existen; si no, descarga uno) con la extensión en desarrollo y
// corre test/vscode/suite.cjs dentro del extension host. Abre una ventana.
//   npm run test:vscode
import { runTests } from "@vscode/test-electron";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const candidates = [
  process.env.VSCODE_EXE,
  join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  "/usr/share/code/code",
].filter(Boolean);
const vscodeExecutablePath = candidates.find((p) => existsSync(p));
const userDataDir = mkdtempSync(join(tmpdir(), "dbml-erd-test-"));

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(here, "suite.cjs"),
    launchArgs: [
      join(root, "samples"),
      "--disable-extensions",
      "--disable-workspace-trust",
      "--disable-gpu",
      `--user-data-dir=${userDataDir}`,
    ],
  });
} catch (e) {
  console.error("integration test failed:", e);
  process.exit(1);
}
