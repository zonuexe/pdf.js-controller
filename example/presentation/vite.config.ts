import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

function pdfjsCmaps(): Plugin {
  const cmapsSrc = path.join(pdfjsRoot, "cmaps");
  const serveRoot = `${cmapsSrc}${path.sep}`;

  return {
    name: "pdfjs-cmaps",
    configureServer(server) {
      server.middlewares.use("/cmaps", (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(
          /^\/+/,
          "",
        );
        if (!relative) {
          next();
          return;
        }
        const file = path.resolve(cmapsSrc, relative);
        if (!file.startsWith(serveRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle({ dir }) {
      if (!dir) {
        return;
      }
      fs.cpSync(cmapsSrc, path.join(dir, "cmaps"), { recursive: true });
    },
  };
}

export default defineConfig({
  server: {
    port: 9080,
    strictPort: true,
  },
  preview: {
    port: 9080,
    strictPort: true,
  },
  resolve: {
    alias: [
      {
        find: "@zonuexe/pdf.js-controller/css/pdf-slide.css",
        replacement: path.join(repoRoot, "css/pdf-slide.css"),
      },
      {
        find: "@zonuexe/pdf.js-controller",
        replacement: path.join(repoRoot, "src/browser-entry.ts"),
      },
    ],
  },
  plugins: [pdfjsCmaps()],
});
