import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillService } from "../lib/service.js";
import { loadEnvFile, parseInteger } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.dirname(__dirname);

loadEnvFile(path.join(ROOT_DIR, ".env"));

const service = new SkillService({
  dataFile: path.join(ROOT_DIR, "data", "skills-db.json"),
  githubToken: process.env.GITHUB_TOKEN || "",
  refreshIntervalHours: parseInteger(process.env.REFRESH_INTERVAL_HOURS, 24)
});

await service.init();
const result = await service.refresh({ force: true, reason: "cli" });
console.log(
  JSON.stringify(
    {
      skipped: result.skipped,
      generatedAt: result.snapshot?.createdAt,
      sourceStatus: result.sourceStatus
    },
    null,
    2
  )
);
