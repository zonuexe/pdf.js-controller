import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite-plus";

function stripDeclarationMaps(outDir: string): void {
  if (!fs.existsSync(outDir)) {
    return;
  }
  for (const name of fs.readdirSync(outDir)) {
    const file = path.join(outDir, name);
    if (name.endsWith(".d.ts.map") || name.endsWith(".d.mts.map")) {
      fs.unlinkSync(file);
      continue;
    }
    if (!name.endsWith(".d.ts") && !name.endsWith(".d.mts")) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const next = text.replace(/\n\/\/# sourceMappingURL=.*\n?$/u, "\n");
    if (next !== text) {
      fs.writeFileSync(file, next);
    }
  }
}

export default defineConfig({
  defaultPackage: {
    dev: "./example/presentation",
    preview: "./example/presentation",
  },
  pack: {
    entry: {
      PDFJSController: "src/browser-entry.ts",
    },
    dts: true,
    sourcemap: true,
    // Declaration maps point at unpublished src/, and top-level sourcemap: true
    // still writes a dangling sourceMappingURL into the .d.mts.
    onSuccess() {
      stripDeclarationMaps("dist");
    },
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "example/presentation/dist/**"],
  },
});
