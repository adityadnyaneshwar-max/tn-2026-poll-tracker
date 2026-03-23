import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), "public");
const POLLS_PATH = join(PUBLIC_DIR, "data", "polls.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(payload, null, 2));
}

function sendFile(response, filePath) {
  const ext = extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": ext === ".json" ? "no-store" : "public, max-age=300"
  };

  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}

function resolvePath(urlPath) {
  if (urlPath === "/") {
    return join(PUBLIC_DIR, "index.html");
  }

  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  return join(PUBLIC_DIR, safePath);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);

  if (url.pathname === "/api/polls") {
    try {
      const data = JSON.parse(readFileSync(POLLS_PATH, "utf8"));
      sendJson(response, 200, data);
    } catch (error) {
      sendJson(response, 500, {
        error: "poll_data_unavailable",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
    return;
  }

  const filePath = resolvePath(url.pathname);

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  sendFile(response, filePath);
}).listen(PORT, HOST, () => {
  console.log(`Poll tracker running at http://${HOST}:${PORT}`);
});
