import { copyExportAssets } from "./scripts/export-assets";
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/server/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist/server",
  clean: true,
  onSuccess: async () => copyExportAssets(),
  // node:sqlite is a prefix-only builtin; stripping node: makes Node look for
  // an unrelated npm package at runtime.
  removeNodeProtocol: false,
});
