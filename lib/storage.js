import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const EMPTY_DB = {
  snapshots: [],
  meta: {
    lastRefreshAt: null,
    lastRefreshReason: null,
    nextRefreshAt: null,
    lastError: null,
    sourceStatus: []
  }
};

export function normalizeDatabase(parsed) {
  return {
    snapshots: Array.isArray(parsed?.snapshots) ? parsed.snapshots : [],
    meta: {
      ...EMPTY_DB.meta,
      ...(parsed?.meta || {})
    }
  };
}

export async function readDatabase(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return normalizeDatabase(parsed);
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

export async function writeDatabase(filePath, db) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(db, null, 2), "utf8");
  await rename(tempPath, filePath);
}

export function createFileDatabaseAdapter(filePath) {
  return {
    async read() {
      return readDatabase(filePath);
    },
    async write(db) {
      await writeDatabase(filePath, db);
    }
  };
}

export function upsertSnapshot(db, snapshot, metaPatch = {}) {
  const snapshots = Array.isArray(db.snapshots) ? [...db.snapshots] : [];
  const existingIndex = snapshots.findIndex((item) => item.dateKey === snapshot.dateKey);

  if (existingIndex >= 0) {
    snapshots[existingIndex] = snapshot;
  } else {
    snapshots.push(snapshot);
  }

  snapshots.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    snapshots: snapshots.slice(-90),
    meta: {
      ...EMPTY_DB.meta,
      ...(db.meta || {}),
      ...metaPatch
    }
  };
}
