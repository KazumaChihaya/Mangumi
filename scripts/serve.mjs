import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const pagesMode = process.argv.includes("--pages");
const basePath = pagesMode ? "/Mangumi" : "";
const root = resolve(
  fileURLToPath(
    new URL(
      pagesMode ? "../apps/member/dist-pages/" : "../apps/member/dist/",
      import.meta.url,
    ),
  ),
);
const port = Number(process.env.PORT || (pagesMode ? 4183 : 4173));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (
      basePath &&
      pathname !== basePath &&
      !pathname.startsWith(basePath + "/")
    ) {
      res.writeHead(404);
      res.end("Outside preview base path");
      return;
    }
    const base = resolve(root, "." + (pathname.slice(basePath.length) || "/"));
    if (base !== root && !base.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const candidates = pagesMode
      ? [base, resolve(base, "index.html")]
      : [base, base + ".html", resolve(base, "index.html")];
    let file;
    for (const candidate of candidates)
      if (await exists(candidate)) {
        file = candidate;
        break;
      }
    let status = 200;
    if (!file) {
      status = 404;
      file = resolve(root, "+not-found.html");
      if (!(await exists(file))) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
    }
    res.writeHead(status, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": /sw\.js$|\.html$|manifest\.json$/.test(file)
        ? "no-cache"
        : "public, max-age=3600",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
}).listen({ port, host: "::", ipv6Only: false }, () =>
  process.stdout.write(
    `Mangumi preview: http://localhost:${port}${basePath}/\n`,
  ),
);
