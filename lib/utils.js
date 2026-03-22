import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseMetric(value) {
  if (typeof value !== "string") {
    return toNumber(value);
  }

  const normalized = value.trim().replace(/,/g, "");
  const match = normalized.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!match) {
    return toNumber(normalized.replace(/[^\d.]/g, ""));
  }

  const base = toNumber(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  return Number((base * multiplier).toFixed(3));
}

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRepoFullName(value, owner = "", repo = "") {
  const direct = normalizeWhitespace(value).toLowerCase();
  if (direct) {
    return direct;
  }

  return [owner, repo].filter(Boolean).join("/").toLowerCase();
}

export function isExcludedRepo(repoFullName = "", owner = "", repo = "") {
  const normalized = normalizeRepoFullName(repoFullName, owner, repo);
  if (!normalized) {
    return slugify(owner) === "openclaw";
  }

  const normalizedOwner = normalized.split("/")[0] || slugify(owner);
  return normalizedOwner === "openclaw" || normalized.includes("openclaw/");
}

export function isExcludedQuery(value) {
  return slugify(value).includes("openclaw");
}

export function humanizeSlug(value) {
  return normalizeWhitespace(String(value || "").replace(/[-_]+/g, " "));
}

export function decodeHtmlEntities(value) {
  const input = String(value || "");
  const decodedNumeric = input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));

  return decodedNumeric
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")));
}

export function formatCompactNumber(value) {
  if (value >= 1_000_000) {
    return `${round(value / 1_000_000, 1)}M`;
  }
  if (value >= 1_000) {
    return `${round(value / 1_000, 1)}K`;
  }
  return String(value);
}

export function formatDateKey(dateLike) {
  const date = new Date(dateLike);
  return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = clamp(concurrency, 1, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
