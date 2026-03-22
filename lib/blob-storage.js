import { put } from "@vercel/blob";
import { EMPTY_DB, normalizeDatabase } from "./storage.js";

function resolveToken(token) {
  return token || process.env.BLOB_READ_WRITE_TOKEN || "";
}

function resolveStoreId(token) {
  return (token.split("_")[3] || "").toLowerCase();
}

function createPublicBlobUrl(pathname, token) {
  const storeId = resolveStoreId(token);
  if (!storeId) {
    return "";
  }

  return `https://${storeId}.public.blob.vercel-storage.com/${pathname}`;
}

export function createBlobDatabaseAdapter({ pathname = "skill-recommender/skills-db.json", token = "" } = {}) {
  const resolvedToken = resolveToken(token);

  if (!resolvedToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN 未配置，无法启用 Vercel Blob 存储");
  }

  return {
    async read() {
      const blobUrl = createPublicBlobUrl(pathname, resolvedToken);
      if (!blobUrl) {
        return structuredClone(EMPTY_DB);
      }

      let response;
      try {
        response = await fetch(blobUrl);
      } catch {
        return structuredClone(EMPTY_DB);
      }

      if (!response || response.status !== 200) {
        return structuredClone(EMPTY_DB);
      }

      const content = await response.text();
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
