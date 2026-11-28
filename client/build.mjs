// Client build for the plain Render version.
//
// 1. Tailwind v4 CLI compiles client/src/theme.css -> client/dist/theme.css
//    (theme.css is linked from index.html, not imported from JS).
// 2. Bun.build bundles client/src/main.tsx -> client/dist/main.js,
//    copying imported image assets (jpg/webp/png/svg) into dist/.
// 3. client/index.html is copied to client/dist/index.html with its
//    script tag pointed at the built ./main.js.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("./client/dist", { recursive: true });

// --- Tailwind -------------------------------------------------------------
// Run the locally installed Tailwind CLI with Bun itself (no `bunx` on
// PATH — this also works on Render, where only `bun` is installed).
const tw = spawnSync(
  process.execPath,
  [
    "./node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i",
    "./client/src/theme.css",
    "-o",
    "./client/dist/theme.css",
    "--minify",
  ],
  { stdio: "inherit" },
);
if (tw.status !== 0) throw new Error("tailwind build failed");

// --- JS bundle ------------------------------------------------------------
const result = await Bun.build({
  entrypoints: ["./client/src/main.tsx"],
  outdir: "./client/dist",
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  loader: { ".jpg": "file", ".jpeg": "file", ".png": "file", ".webp": "file", ".svg": "file" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("client bundle failed");
}

// --- HTML -----------------------------------------------------------------
const html = readFileSync("./client/index.html", "utf8").replace(
  '<script src="./src/main.tsx" type="module"></script>',
  '<script src="./main.js" type="module" defer></script>',
);
writeFileSync("./client/dist/index.html", html);
console.log("client built -> client/dist");
