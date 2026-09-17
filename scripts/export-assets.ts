import { mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
export function copyExportAssets() {
  for (const path of [
    "client/components/Preview.tsx",
    "client/components/TemplateControls.tsx",
    "client/styles.css",
    "client/design-runtime/Library.tsx",
    "domain/library.ts",
    "domain/design.ts",
    "domain/foundation.ts",
    "domain/tokens.ts",
  ]) {
    const target = `dist/server/export-templates/${path}`;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(`src/${path}`, target);
  }
  copyFileSync("package.json", "dist/server/package.json");
}
