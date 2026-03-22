import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBlobDatabaseAdapter } from "../lib/blob-storage.js";
import { SkillService } from "../lib/service.js";
import { createFileDatabaseAdapter } from "../lib/storage.js";
import { loadEnvFile, parseInteger } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.dirname(__dirname);

loadEnvFile(path.join(ROOT_DIR, ".env"));

function createStorageAdapter() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return createBlobDatabaseAdapter({
      pathname: process.env.BLOB_DB_PATH || "skill-recommender/skills-db.json",
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
  }

  return createFileDatabaseAdapter(path.join(ROOT_DIR, "data", "skills-db.json"));
}

export async function createRuntimeService() {
  const service = new SkillService({
    dataFile: path.join(ROOT_DIR, "data", "skills-db.json"),
    storageAdapter: createStorageAdapter(),
    githubToken: process.env.GITHUB_TOKEN || "",
    refreshIntervalHours: parseInteger(process.env.REFRESH_INTERVAL_HOURS, 24),
    enableSchedule: false
  });

  await service.init();
  return service;
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
