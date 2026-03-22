import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  decodeHtmlEntities,
  isExcludedRepo,
  mapWithConcurrency,
  normalizeWhitespace,
  parseMetric,
  slugify,
  stripHtml,
  uniq
} from "./utils.js";

const execFile = promisify(execFileCallback);
const SOURCE_TIMEOUT_MS = 30_000;
const GITHUB_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 48;
const SUPPLEMENTAL_SKILLS_OWNERS = ["obra", "openclaw"];
const SUPPLEMENTAL_OWNER_REPO_LIMIT = 3;
const SUPPLEMENTAL_REPO_SKILL_LIMIT = 12;

function createHeaders(extraHeaders = {}) {
  return {
    "User-Agent": "hot-skill-recommender/1.0",
    "Accept": "text/html,application/json",
    ...extraHeaders
  };
}

export async function fetchText(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: createHeaders(options.headers),
      signal: AbortSignal.timeout(options.timeoutMs || SOURCE_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    return response.text();
  } catch (error) {
    const fallbackText = await fetchTextWithCurl(url, options.timeoutMs || SOURCE_TIMEOUT_MS).catch(() => null);
    if (fallbackText !== null) {
      return fallbackText;
    }
    throw error;
  }
}

async function fetchTextWithCurl(url, timeoutMs) {
  const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
  const { stdout } = await execFile("curl", ["-L", "--silent", "--show-error", "--max-time", String(timeoutSeconds), url], {
    timeout: timeoutMs + 1_000,
    maxBuffer: 8 * 1024 * 1024
  });
  return stdout;
}

function normalizeSkillsShHtml(html) {
  let text = String(html || "");
  const replacements = [
    ["\\\\u003c", "<"],
    ["\\\\u003e", ">"],
    ["\\\\u0026", "&"],
    ["\\\\u002f", "/"],
    ["\\\\/", "/"],
    ['\\"', '"']
  ];

  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }

  return decodeHtmlEntities(text);
}

export function parseSkillsShTrending(html, limit = DEFAULT_LIMIT) {
  const normalized = normalizeSkillsShHtml(html);
  const pattern = /"source":"([^"]+)","skillId":"([^"]+)","name":"([^"]+)","installs":(\d+)/g;
  const items = [];
  const seen = new Set();

  let match;
  while ((match = pattern.exec(normalized)) && items.length < limit) {
    const repoFullName = normalizeWhitespace(match[1]);
    const skillId = normalizeWhitespace(match[2]);
    const name = normalizeWhitespace(match[3]);
    const installs = Number(match[4]);
    const [owner, repo] = repoFullName.split("/");

    if (!owner || !repo || !skillId) {
      continue;
    }

    const key = `${owner.toLowerCase()}:${slugify(skillId)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    items.push({
      key,
      owner,
      repo,
      repoFullName,
      skillId,
      name,
      installs24h: installs,
      detailUrl: `https://skills.sh/${repoFullName}/${skillId}`,
      sourceUrl: "https://skills.sh/trending",
      sourceType: "skills.sh"
    });
  }

  return items;
}

export function parseSkillsShOwnerCatalog(html, owner, limit = SUPPLEMENTAL_OWNER_REPO_LIMIT) {
  const normalized = normalizeSkillsShHtml(html);
  const ownerPattern = new RegExp(
    `href="/${owner}/([^"/?#]+)"[\\s\\S]*?<h3[^>]*>([^<]+)</h3>[\\s\\S]*?<span class="font-mono text-sm text-foreground">([\\d.,]+(?:[KMB])?)</span>`,
    "gi"
  );
  const items = [];
  const seen = new Set();

  let match;
  while ((match = ownerPattern.exec(normalized)) && items.length < limit) {
    const repo = normalizeWhitespace(match[1]);
    const name = stripHtml(match[2]);
    const installsTotal = parseMetric(match[3]);
    if (!repo || seen.has(repo)) {
      continue;
    }
    seen.add(repo);

    items.push({
      owner,
      repo,
      name: name || repo,
      repoFullName: `${owner}/${repo}`,
      installsTotal,
      detailUrl: `https://skills.sh/${owner}/${repo}`,
      sourceUrl: `https://skills.sh/${owner}`,
      sourceType: "skills.sh-owner"
    });
  }

  return items;
}

export function parseSkillsShRepoPage(html, owner, repo, limit = SUPPLEMENTAL_REPO_SKILL_LIMIT) {
  const normalized = normalizeSkillsShHtml(html);
  const repoPattern = new RegExp(
    `href="/${owner}/${repo}/([^"/?#]+)"[\\s\\S]*?<h3[^>]*>([^<]+)</h3>[\\s\\S]*?<span class="font-mono text-sm text-foreground">([\\d.,]+(?:[KMB])?)</span>`,
    "gi"
  );
  const items = [];
  const seen = new Set();

  let match;
  while ((match = repoPattern.exec(normalized)) && items.length < limit) {
    const skillId = normalizeWhitespace(match[1]);
    const name = stripHtml(match[2]);
    const installsTotal = parseMetric(match[3]);
    const key = `${owner.toLowerCase()}:${slugify(skillId)}`;

    if (!skillId || seen.has(key)) {
      continue;
    }
    seen.add(key);

    items.push({
      key,
      owner,
      repo,
      repoFullName: `${owner}/${repo}`,
      skillId,
      name: name || skillId,
      installsTotal,
      detailUrl: `https://skills.sh/${owner}/${repo}/${skillId}`,
      sourceUrl: `https://skills.sh/${owner}/${repo}`,
      sourceType: "skills.sh-catalog"
    });
  }

  return items;
}

function inferRepoSlug(pathname, skillName) {
  const match = pathname.match(/^\/skill\/([^/]+)\/([^/]+)/);
  if (!match) {
    return null;
  }

  const combinedSlug = match[2];
  const skillSlug = slugify(skillName);
  if (combinedSlug.endsWith(`-${skillSlug}`)) {
    return combinedSlug.slice(0, -(skillSlug.length + 1)) || null;
  }

  return combinedSlug || null;
}

export function parseAgentSkillsRepoTop(html, limit = DEFAULT_LIMIT) {
  const articlePattern = /<article class="skill-card">([\s\S]*?)<\/article>/g;
  const items = [];
  const seen = new Set();

  let match;
  while ((match = articlePattern.exec(String(html || ""))) && items.length < limit) {
    const block = match[1];
    const skillPath = block.match(/<a href="([^"]+)"\s+class="skill-name">/)?.[1];
    const name = stripHtml(block.match(/class="skill-name">\s*([\s\S]*?)\s*<\/a>/)?.[1]);
    const owner = stripHtml(block.match(/class="skill-author">\s*@([\s\S]*?)\s*<\/a>/)?.[1]);
    const description = stripHtml(block.match(/<p class="skill-description">\s*([\s\S]*?)\s*<\/p>/)?.[1]);
    const stars = parseMetric(block.match(/<span class="stat">[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1] || "0");
    const tags = [...block.matchAll(/<span class="tag">([\s\S]*?)<\/span>/g)]
      .map((tagMatch) => stripHtml(tagMatch[1]))
      .filter(Boolean);

    if (!owner || !name || !skillPath) {
      continue;
    }

    const key = `${owner.toLowerCase()}:${slugify(name)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    items.push({
      key,
      owner,
      name,
      description,
      stars,
      tags,
      repoSlug: inferRepoSlug(skillPath, name),
      sourceUrl: `https://agentskillsrepo.com${skillPath}`,
      sourceType: "agentskillsrepo"
    });
  }

  return items;
}

async function fetchSupplementalSkillsShCatalog(fetchTextImpl) {
  const ownerResults = await Promise.allSettled(
    SUPPLEMENTAL_SKILLS_OWNERS.map(async (owner) => {
      const html = await fetchTextImpl(`https://skills.sh/${owner}`);
      return {
        owner,
        repos: parseSkillsShOwnerCatalog(html, owner)
      };
    })
  );

  const repos = ownerResults
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value.repos);

  const repoResults = await Promise.allSettled(
    repos.map(async (repoEntry) => {
      const html = await fetchTextImpl(repoEntry.detailUrl);
      return parseSkillsShRepoPage(html, repoEntry.owner, repoEntry.repo);
    })
  );

  return {
    items: repoResults
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value),
    status: {
      source: "skills.sh-catalog",
      ok: ownerResults.some((result) => result.status === "fulfilled") && repoResults.some((result) => result.status === "fulfilled"),
      count: repoResults
        .filter((result) => result.status === "fulfilled")
        .reduce((sum, result) => sum + result.value.length, 0),
      error:
        ownerResults.every((result) => result.status === "rejected") && repoResults.every((result) => result.status === "rejected")
          ? ownerResults[0]?.reason?.message || repoResults[0]?.reason?.message || "supplemental crawl failed"
          : null
    }
  };
}

async function fetchGitHubRepo(repoFullName, token) {
  const headers = {
    "Accept": "application/vnd.github+json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: createHeaders(headers),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`GitHub ${repoFullName} returned ${response.status}`);
  }

  const payload = await response.json();
  return {
    repoFullName,
    description: normalizeWhitespace(payload.description),
    stars: Number(payload.stargazers_count || 0),
    forks: Number(payload.forks_count || 0),
    repoUrl: payload.html_url || `https://github.com/${repoFullName}`,
    pushedAt: payload.pushed_at || null,
    homepage: payload.homepage || "",
    topics: Array.isArray(payload.topics) ? payload.topics : [],
    language: payload.language || ""
  };
}

export async function fetchGitHubRepoMap(repoFullNames, token) {
  const uniqueRepos = uniq(repoFullNames);
  const pairs = await mapWithConcurrency(uniqueRepos, 4, async (repoFullName) => {
    try {
      return [repoFullName, await fetchGitHubRepo(repoFullName, token)];
    } catch {
      return [repoFullName, null];
    }
  });

  return new Map(pairs.filter(([, value]) => Boolean(value)));
}

function mergeSkillRecord(record, source) {
  const target = record || {
    key: source.key,
    owner: source.owner,
    name: source.name,
    skillId: source.skillId || slugify(source.name),
    repo: source.repo || source.repoSlug || null,
    repoFullName: source.repoFullName || null,
    repoUrl: null,
    detailUrl: source.detailUrl || source.sourceUrl,
    sourceLinks: [],
    description: "",
    tags: [],
    installs24h: 0,
    catalogInstalls: 0,
    stars: 0,
    forks: 0,
    references: 0,
    language: "",
    pushedAt: null,
    homepage: "",
    sources: {}
  };

  target.sourceLinks = uniq([...target.sourceLinks, source.sourceUrl]);
  target.references = uniq([...Object.keys(target.sources), source.sourceType]).length;
  target.tags = uniq([...(target.tags || []), ...(source.tags || [])]);

  if (source.sourceType === "skills.sh") {
    target.name = target.name || source.name;
    target.skillId = source.skillId || target.skillId;
    target.repo = source.repo;
    target.repoFullName = source.repoFullName;
    target.detailUrl = source.detailUrl || target.detailUrl;
    target.installs24h = Math.max(target.installs24h || 0, source.installs24h || 0);
    target.sources["skills.sh"] = {
      installs24h: source.installs24h,
      url: source.detailUrl
    };
  }

  if (source.sourceType === "skills.sh-catalog") {
    target.name = target.name || source.name;
    target.skillId = source.skillId || target.skillId;
    target.repo = source.repo || target.repo;
    target.repoFullName = source.repoFullName || target.repoFullName;
    target.detailUrl = source.detailUrl || target.detailUrl;
    target.catalogInstalls = Math.max(target.catalogInstalls || 0, source.installsTotal || 0);
    target.sources["skills.sh-catalog"] = {
      installsTotal: source.installsTotal,
      url: source.detailUrl || source.sourceUrl
    };
  }

  if (source.sourceType === "agentskillsrepo") {
    target.description = target.description || source.description;
    target.stars = Math.max(target.stars || 0, source.stars || 0);
    target.repo = target.repo || source.repoSlug || null;
    target.sources.agentskillsrepo = {
      stars: source.stars,
      url: source.sourceUrl
    };
  }

  target.references = Object.keys(target.sources).length;
  return target;
}

function applyGitHubMetadata(record, githubRepo) {
  if (!githubRepo) {
    return record;
  }

  return {
    ...record,
    repoFullName: record.repoFullName || githubRepo.repoFullName,
    repoUrl: githubRepo.repoUrl || record.repoUrl,
    description: record.description || githubRepo.description,
    stars: Math.max(record.stars || 0, githubRepo.stars || 0),
    forks: Math.max(record.forks || 0, githubRepo.forks || 0),
    pushedAt: githubRepo.pushedAt || record.pushedAt,
    homepage: githubRepo.homepage || record.homepage,
    language: githubRepo.language || record.language,
    tags: uniq([...(record.tags || []), ...(githubRepo.topics || [])]),
    sources: {
      ...record.sources,
      github: {
        stars: githubRepo.stars,
        forks: githubRepo.forks,
        url: githubRepo.repoUrl
      }
    }
  };
}

export async function fetchHotSkillSources({ githubToken, fetchTextImpl = fetchText } = {}) {
  const [skillsResult, agentSkillsResult, supplementalCatalogResult] = await Promise.allSettled([
    fetchTextImpl("https://skills.sh/trending").then((html) => parseSkillsShTrending(html)),
    fetchTextImpl("https://agentskillsrepo.com/top").then((html) => parseAgentSkillsRepoTop(html)),
    fetchSupplementalSkillsShCatalog(fetchTextImpl)
  ]);

  const sourceStatus = [
    {
      source: "skills.sh",
      ok: skillsResult.status === "fulfilled",
      count: skillsResult.status === "fulfilled" ? skillsResult.value.length : 0,
      error: skillsResult.status === "rejected" ? skillsResult.reason.message : null
    },
    {
      source: "agentskillsrepo",
      ok: agentSkillsResult.status === "fulfilled",
      count: agentSkillsResult.status === "fulfilled" ? agentSkillsResult.value.length : 0,
      error: agentSkillsResult.status === "rejected" ? agentSkillsResult.reason.message : null
    },
    {
      source: "skills.sh-catalog",
      ok: supplementalCatalogResult.status === "fulfilled" ? supplementalCatalogResult.value.status.ok : false,
      count: supplementalCatalogResult.status === "fulfilled" ? supplementalCatalogResult.value.status.count : 0,
      error: supplementalCatalogResult.status === "fulfilled" ? supplementalCatalogResult.value.status.error : supplementalCatalogResult.reason.message
    }
  ];

  const merged = new Map();

  if (skillsResult.status === "fulfilled") {
    for (const skill of skillsResult.value) {
      merged.set(skill.key, mergeSkillRecord(merged.get(skill.key), skill));
    }
  }

  if (agentSkillsResult.status === "fulfilled") {
    for (const skill of agentSkillsResult.value) {
      merged.set(skill.key, mergeSkillRecord(merged.get(skill.key), skill));
    }
  }

  if (supplementalCatalogResult.status === "fulfilled") {
    for (const skill of supplementalCatalogResult.value.items) {
      merged.set(skill.key, mergeSkillRecord(merged.get(skill.key), skill));
    }
  }

  const repoMap = await fetchGitHubRepoMap(
    [...merged.values()].map((item) => item.repoFullName).filter(Boolean),
    githubToken
  );

  const items = [...merged.values()]
    .map((item) => applyGitHubMetadata(item, repoMap.get(item.repoFullName)))
    .filter((item) => !isExcludedRepo(item.repoFullName, item.owner, item.repo))
    .map((item) => ({
      ...item,
      repoUrl: item.repoUrl || (item.repoFullName ? `https://github.com/${item.repoFullName}` : null),
      references: uniq(Object.keys(item.sources)).length
    }));

  return {
    items,
    sourceStatus
  };
}
