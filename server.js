import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillService } from "./lib/service.js";
import { loadEnvFile, parseInteger } from "./lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "skills-db.json");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = parseInteger(process.env.PORT, 3000);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const service = new SkillService({
  dataFile: DATA_FILE,
  githubToken: process.env.GITHUB_TOKEN || "",
  refreshIntervalHours: parseInteger(process.env.REFRESH_INTERVAL_HOURS, 24)
});

await service.init();
service.ensureFreshData().catch((error) => {
  console.error("Initial refresh failed:", error.message);
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(pathname, res) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(target)));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "禁止访问该资源" });
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(fullPath);
  } catch {
    sendJson(res, 404, { error: "资源不存在" });
    return;
  }

  if (!fileStat.isFile()) {
    sendJson(res, 404, { error: "资源不存在" });
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);

    if (req.method === "GET" && requestUrl.pathname === "/api/skills") {
      const payload = service.getDashboard({
        period: requestUrl.searchParams.get("period") || "day",
        query: requestUrl.searchParams.get("q") || "",
        source: requestUrl.searchParams.get("source") || "all",
        limit: requestUrl.searchParams.get("limit") || "24"
      });
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/projects") {
      const payload = service.getProjectDashboard({
        window: requestUrl.searchParams.get("window") || "7d",
        query: requestUrl.searchParams.get("q") || "",
        limit: requestUrl.searchParams.get("limit") || "24"
      });
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(res, 200, service.getStatus());
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/refresh") {
      await readBody(req);
      const payload = await service.refresh({ force: true, reason: "manual" });
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(requestUrl.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "不支持的请求方法" });
  } catch (error) {
    sendJson(res, 500, {
      error: "服务内部错误",
      details: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Hot Skill Recommender is running on http://localhost:${PORT}`);
  console.log(existsSync(DATA_FILE) ? `Using cache file: ${DATA_FILE}` : "Cache file will be created after the first refresh.");
});
