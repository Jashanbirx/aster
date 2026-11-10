// Bundles src/main.jsx (and all imported CSS) into dist/. With --pages, also copies the build to docs/ for GitHub Pages.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src/main.jsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  loader: { ".js": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(dist, "app.js"),
  logLevel: "warning",
});
fs.copyFileSync(path.join(root, "src/index.html"), path.join(dist, "index.html"));

if (process.argv.includes("--pages")) {
  const docs = path.join(root, "docs");
  for (const f of ["index.html", "app.js", "app.css"]) fs.copyFileSync(path.join(dist, f), path.join(docs, f));
  fs.writeFileSync(path.join(docs, ".nojekyll"), "");
  console.log("Copied build to docs/ for GitHub Pages");
}
const kb = (f) => Math.round(fs.statSync(path.join(dist, f)).size / 1024);
console.log(`Built dist/: app.js ${kb("app.js")} KB, app.css ${kb("app.css")} KB`);
