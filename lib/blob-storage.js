import { get, put } from "@vercel/blob";
import { EMPTY_DB, normalizeDatabase } from "./storage.js";

function resolveToken(token) {
  return token || process.env.BLOB_READ_WRITE_TOKEN || "";
}

export function createBlobDatabaseAdapter({ pathname = "skill-recommender/skills-db.json", token = "" } = {}) {
  const resolvedToken = resolveToken(token);

  if (!resolvedToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN 未配置，无法启用 Vercel Blob 存储");
  }

  return {
    async read() {
      let response;
      try {
        response = await get(pathname, {
          access: "public",
          token: resolvedToken,
          useCache: false
        });
      } catch {
        return structuredClone(EMPTY_DB);
      }

      if (!response || response.statusCode !== 200 || !response.stream) {
        return structuredClone(EMPTY_DB);
      }

      const content = await new Response(response.stream).text();
      try {
        return normalizeDatabase(JSON.parse(content));
      } catch {
        return structuredClone(EMPTY_DB);
      }
    },
    async write(db) {
      await put(pathname, JSON.stringify(db, null, 2), {
        access: "public",
        token: resolvedToken,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json"
      });
    }
  };
}
