import { defineConfig } from "vite-plus";

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
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "example/presentation/dist/**"],
  },
});
