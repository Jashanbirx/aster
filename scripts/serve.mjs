// Minimal static server for dist/ (no dependencies). Usage: node scripts/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve("dist");
const port = Number(process.argv[2] || process.env.PORT || 8000);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(dir, url === "/" ? "index.html" : url);
  if (!file.startsWith(dir) || !fs.existsSync(file)) file = path.join(dir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Aster running at http://localhost:${port}`));
