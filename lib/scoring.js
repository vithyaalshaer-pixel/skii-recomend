import {
  clamp,
  decodeHtmlEntities,
  formatCompactNumber,
  formatDateKey,
  humanizeSlug,
  isExcludedQuery,
  isExcludedRepo,
  normalizeRepoFullName,
  round,
  slugify,
  uniq
} from "./utils.js";

const LEGACY_PERIOD_DAYS = {
  day: 1,
  week: 7,
  month: 30
};

const PROJECT_WINDOW_DAYS = {
  "1d": 1,
  "7d": 7
};

const DAY_MS = 86_400_000;
const PERIOD_WEIGHTS = {
  day: { install: 0.42, catalog: 0.1, star: 0.26, coverage: 0, reference: 0.14, avg: 0, momentum: 0, recency: 0.08 },
  week: { install: 0.24, catalog: 0.17, star: 0.25, coverage: 0.14, reference: 0.1, avg: 0.06, momentum: 0.04, recency: 0 },
  month: { install: 0.18, catalog: 0.24, star: 0.23, coverage: 0.14, reference: 0.11, avg: 0.06, momentum: 0.04, recency: 0 }
};

const PROJECT_GROWTH_WEIGHTS = {
  starGrowth: 0.4,
  activity: 0.2,
  source: 0.15,
  breadth: 0.1,
  stars: 0.1,
  codeUpdate: 0.05
};

const FOCUS_RULES = [
  { pattern: /(front|ui|ux|design|css|html|layout|animation|web)/i, label: "前端界面与体验实现" },
  { pattern: /(react|next|vue|nuxt|svelte|angular)/i, label: "现代前端框架开发" },
  { pattern: /(test|jest|vitest|playwright|qa|lint|fix|debug|ci)/i, label: "测试修复与质量保障" },
  { pattern: /(docs?|readme|markdown|writing|copy|seo|blog|content)/i, label: "文档写作与内容生产" },
  { pattern: /(agent|workflow|subagent|automation|mcp|tooling|orchestr)/i, label: "智能体工作流与工具编排" },
  { pattern: /(auth|security|audit|permission|scan|risk)/i, label: "安全审计与权限治理" },
  { pattern: /(postgres|database|sql|prisma|supabase|data)/i, label: "数据库与数据处理" },
  { pattern: /(pdf|pptx|xlsx|docx|video|audio|remotion|slides)/i, label: "文档与多媒体生成" },
  { pattern: /(brand|marketing|social|campaign|growth)/i, label: "营销、品牌与增长内容" }
];

function resolveLegacyPeriod(period = "day") {
  return period in LEGACY_PERIOD_DAYS ? period : "day";
}

function resolveProjectWindow(window = "7d") {
  return window in PROJECT_WINDOW_DAYS ? window : "7d";
}

function logRatio(value, maxValue) {
  if (!value || !maxValue) {
    return 0;
  }

  return Math.log10(value + 1) / Math.log10(maxValue + 1);
}

function detectFocus(skill) {
  const haystack = [skill.name, skill.skillId, skill.description, ...(skill.tags || [])].filter(Boolean).join(" ");
  const match = FOCUS_RULES.find((rule) => rule.pattern.test(haystack));
  return match?.label || "代码、内容与工作流效率提升";
}

function repoKeyOf(skill) {
  return normalizeRepoFullName(skill.repoFullName, skill.owner, skill.repo) || skill.key;
}

function catalogDailyEquivalent(item) {
  return round((item.catalogInstalls || 0) / 30, 1);
}

function filterExcludedSkills(items) {
  return items.filter((item) => !isExcludedRepo(item.repoFullName, item.owner, item.repo));
}

function buildWindowByDays(snapshots, days, offset = 0) {
  const sorted = [...snapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (!sorted.length) {
    return {
      days,
      endTime: null,
      startTime: null,
      snapshots: []
    };
  }

  const anchorTime = new Date(sorted[0].createdAt).getTime();
  const endTime = anchorTime - offset * days * DAY_MS;
  const startTime = endTime - days * DAY_MS + 1;
  const selected = sorted.filter((snapshot) => {
    const snapshotTime = new Date(snapshot.createdAt).getTime();
    return snapshotTime >= startTime && snapshotTime <= endTime;
  });

  return {
    days,
    endTime,
    startTime,
    snapshots: selected
  };
}

function buildLegacyWindow(snapshots, period = "day", offset = 0) {
  const resolvedPeriod = resolveLegacyPeriod(period);
  return buildWindowByDays(snapshots, LEGACY_PERIOD_DAYS[resolvedPeriod], offset);
}

function buildProjectWindow(snapshots, window = "14d", offset = 0) {
  const resolvedWindow = resolveProjectWindow(window);
  if (resolvedWindow === "1d") {
    const sorted = [...snapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const snapshot = sorted[offset] || null;
    return {
      days: 1,
      endTime: snapshot ? new Date(snapshot.createdAt).getTime() : null,
      startTime: snapshot ? new Date(snapshot.createdAt).getTime() : null,
      snapshots: snapshot ? [snapshot] : []
    };
  }

  return buildWindowByDays(snapshots, PROJECT_WINDOW_DAYS[resolvedWindow], offset);
}

function countObservedDays(windowSnapshots) {
  return uniq(windowSnapshots.map((snapshot) => snapshot.dateKey || formatDateKey(snapshot.createdAt))).length;
}

function recencyWeight(ageDays, periodDays) {
  const ratio = ageDays / Math.max(periodDays, 1);
  return Math.max(0.35, 1 - ratio * 0.75);
}

function recencyScore(pushedAt) {
  if (!pushedAt) {
    return 0.18;
  }

  const ageDays = (Date.now() - new Date(pushedAt).getTime()) / DAY_MS;
  if (!Number.isFinite(ageDays)) {
    return 0.18;
  }

  return clamp(1 - ageDays / 180, 0.05, 1);
}

function momentumScore(item) {
  if ((item.daysSeen || 0) < 2) {
    return 0.45;
  }

  const rankLift = clamp((item.rankDeltaWindow || 0) * 0.08, -0.24, 0.24);
  const scoreLift = clamp((item.trendDelta || 0) / 80, -0.24, 0.24);
  return clamp(0.5 + rankLift + scoreLift, 0, 1);
}

function estimationConfidence(item) {
  const coverage = clamp(item.historyCoverage || 0, 0, 1);
  if (coverage >= 1) {
    return 1;
  }

  return round(clamp(Math.sqrt(coverage) * 0.55, 0.08, 0.55), 2);
}

function diversifySkillRankings(items, period) {
  const repoGroups = new Map();
  const ownerGroups = new Map();

  for (const item of items) {
    const repoKey = repoKeyOf(item);
    const ownerKey = item.owner || repoKey;
    const repoGroup = repoGroups.get(repoKey) || [];
    repoGroup.push(item);
    repoGroups.set(repoKey, repoGroup);
    const ownerGroup = ownerGroups.get(ownerKey) || [];
    ownerGroup.push(item);
    ownerGroups.set(ownerKey, ownerGroup);
  }

  const repoOrder = new Map();
  const ownerOrder = new Map();
  for (const [, group] of repoGroups) {
    [...group]
      .sort((a, b) => b.score - a.score || (b.projectedWindowHeat || b.installs24h || 0) - (a.projectedWindowHeat || a.installs24h || 0))
      .forEach((item, index) => {
        repoOrder.set(item.key, index);
      });
  }
  for (const [, group] of ownerGroups) {
    [...group]
      .sort((a, b) => b.score - a.score || (b.projectedWindowHeat || b.installs24h || 0) - (a.projectedWindowHeat || a.installs24h || 0))
      .forEach((item, index) => {
        ownerOrder.set(item.key, index);
      });
  }

  const repoPenaltyStep = period === "day" ? 8.5 : period === "week" ? 9.5 : 10.5;
  const ownerPenaltyStep = period === "day" ? 1.5 : 2.2;
  const clusterPenaltyStep = period === "day" ? 0.6 : 0.9;

  return [...items]
    .map((item) => {
      const repoKey = repoKeyOf(item);
      const ownerKey = item.owner || repoKey;
      const repoGroupSize = repoGroups.get(repoKey)?.length || 1;
      const ownerGroupSize = ownerGroups.get(ownerKey)?.length || 1;
      const repoPenalty = (repoOrder.get(item.key) || 0) * repoPenaltyStep;
      const ownerPenalty = Math.max(0, (ownerOrder.get(item.key) || 0) - (repoOrder.get(item.key) || 0)) * ownerPenaltyStep;
      const clusterPenalty = Math.max(0, repoGroupSize - 1) * clusterPenaltyStep + Math.max(0, ownerGroupSize - repoGroupSize) * 0.35;
      const confidenceBoost = item.installs24h ? 1.5 : item.catalogInstalls ? 0.7 : -1.2;
      const diversifiedScore = round(item.score - repoPenalty - ownerPenalty - clusterPenalty + confidenceBoost, 1);

      return {
        ...item,
        score: diversifiedScore
      };
    })
    .sort((a, b) => b.score - a.score || (b.projectedWindowHeat || b.installsWindow || b.installs24h || 0) - (a.projectedWindowHeat || a.installsWindow || a.installs24h || 0))
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

function diversifyProjectRankings(items) {
  const ownerGroups = new Map();

  for (const item of items) {
    const ownerKey = item.owner || item.repoFullName;
    const group = ownerGroups.get(ownerKey) || [];
    group.push(item);
    ownerGroups.set(ownerKey, group);
  }

  const ownerOrder = new Map();
  for (const [, group] of ownerGroups) {
    [...group]
      .sort((a, b) => b.growthScore - a.growthScore || b.effectiveStarDelta - a.effectiveStarDelta)
      .forEach((item, index) => {
        ownerOrder.set(item.repoFullName, index);
      });
  }

  return [...items]
    .map((item) => {
      const ownerRank = ownerOrder.get(item.repoFullName) || 0;
      const crowdPenalty = ownerRank * 7.5;
      return {
        ...item,
        growthScore: round(item.growthScore - crowdPenalty, 1)
      };
    })
    .sort((a, b) => b.growthScore - a.growthScore || b.effectiveStarDelta - a.effectiveStarDelta || b.stars - a.stars)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

export function buildChineseIntro(skill) {
  const focus = detectFocus(skill);
  const repoLabel = skill.repoFullName || (skill.owner ? `${skill.owner}/${skill.repo || humanizeSlug(skill.name)}` : skill.name);
  const metrics = [];

  if (skill.installs24h) {
    metrics.push(`近 24h 热度约 ${formatCompactNumber(skill.installs24h)} 安装`);
  }
  if (skill.catalogInstalls) {
    metrics.push(`累计安装约 ${formatCompactNumber(skill.catalogInstalls)}`);
  }
  if (skill.stars) {
    metrics.push(`GitHub 标星 ${formatCompactNumber(skill.stars)}`);
  }
  if (skill.references > 1) {
    metrics.push(`已被 ${skill.references} 个热门来源同时收录`);
  }

  const cleanDescription = decodeHtmlEntities(skill.description || "");
  if (/[\u4e00-\u9fff]/.test(cleanDescription)) {
    return `来自 ${repoLabel}，${cleanDescription}`;
  }

  const metricText = metrics.length ? `${metrics.join("，")}。` : "";
  return `来自 ${repoLabel}，主要用于${focus}。${metricText}`.trim();
}

function scoreDailyItems(items) {
  const filtered = filterExcludedSkills(items);
  if (!filtered.length) {
    return [];
  }

  const maxInstalls = Math.max(...filtered.map((item) => item.installs24h || 0), 1);
  const maxCatalog = Math.max(...filtered.map((item) => catalogDailyEquivalent(item)), 1);
  const maxStars = Math.max(...filtered.map((item) => item.stars || 0), 1);
  const weights = PERIOD_WEIGHTS.day;

  const ranked = [...filtered]
    .map((item) => {
      const installScore = logRatio(item.installs24h || 0, maxInstalls);
      const catalogScore = logRatio(catalogDailyEquivalent(item), maxCatalog);
      const starScore = logRatio(item.stars || 0, maxStars);
      const referenceScore = Math.min((item.references || 0) / 3, 1);
      const currentRecencyScore = recencyScore(item.pushedAt);
      const score = round(
        (
          installScore * weights.install +
          catalogScore * weights.catalog +
          starScore * weights.star +
          referenceScore * weights.reference +
          currentRecencyScore * weights.recency
        ) * 100,
        1
      );

      return {
        ...item,
        score,
        chineseIntro: buildChineseIntro(item)
      };
    })
    .sort((a, b) => b.score - a.score || (b.installs24h || b.catalogInstalls || 0) - (a.installs24h || a.catalogInstalls || 0))
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  return diversifySkillRankings(ranked, "day");
}

export function buildSnapshot(items, createdAt, sourceStatus) {
  const enriched = filterExcludedSkills(items).map((item) => ({
    ...item,
    createdAt,
    chineseIntro: item.chineseIntro || buildChineseIntro(item)
  }));

  return {
    dateKey: formatDateKey(createdAt),
    createdAt,
    sourceStatus,
    items: scoreDailyItems(enriched)
  };
}

export function buildPeriodMeta(snapshots, period = "day") {
  const resolvedPeriod = resolveLegacyPeriod(period);
  const window = buildLegacyWindow(snapshots, resolvedPeriod, 0);
  const requiredDays = LEGACY_PERIOD_DAYS[resolvedPeriod];
  const observedDays = countObservedDays(window.snapshots);
  const coverage = round(observedDays / Math.max(requiredDays, 1), 2);

  return {
    period: resolvedPeriod,
    requiredDays,
    observedDays,
    coverage,
    isEstimated: resolvedPeriod !== "day" && observedDays < requiredDays,
    label: resolvedPeriod === "day" ? "日榜" : resolvedPeriod === "week" ? "周榜" : "月榜"
  };
}

function aggregateLegacyWindow(window, period) {
  const snapshots = window.snapshots.map((snapshot) => ({
    ...snapshot,
    items: filterExcludedSkills(snapshot.items || [])
  }));

  if (!snapshots.length) {
    return [];
  }

  if (period === "day") {
    return snapshots[0].items.map((item) => ({
      ...item,
      daysSeen: 1,
      installsWindow: item.installs24h || 0,
      projectedWindowHeat: item.installs24h || catalogDailyEquivalent(item),
      effectiveWindowHeat: item.installs24h || catalogDailyEquivalent(item),
      observedDailyHeat: item.installs24h || catalogDailyEquivalent(item),
      avgDailyScore: item.score,
      weightedInstalls: item.installs24h || 0,
      historyCoverage: 1,
      coverageGap: 0,
      estimateFactor: 1,
      estimationConfidence: 1,
      rankDeltaWindow: 0,
      trendDelta: 0
    }));
  }

  const windowSnapshots = [...snapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const weights = PERIOD_WEIGHTS[period] || PERIOD_WEIGHTS.week;
  const groups = new Map();
  for (const snapshot of windowSnapshots) {
    const snapshotTime = new Date(snapshot.createdAt).getTime();
    const ageDays = Math.max(0, Math.round((window.endTime - snapshotTime) / DAY_MS));
    const weight = recencyWeight(ageDays, window.days);

    for (const item of snapshot.items) {
      const current = groups.get(item.key) || {
        latest: item,
        earliest: item,
        daysSeen: 0,
        installsWindow: 0,
        weightedInstalls: 0,
        scoreSum: 0,
        weightedScoreSum: 0,
        weightSum: 0
      };

      if (new Date(item.createdAt || snapshot.createdAt).getTime() >= new Date(current.latest.createdAt || 0).getTime()) {
        current.latest = item;
      }
      if (new Date(item.createdAt || snapshot.createdAt).getTime() <= new Date(current.earliest.createdAt || snapshot.createdAt).getTime()) {
        current.earliest = item;
      }

      current.daysSeen += 1;
      current.installsWindow += item.installs24h || 0;
      current.weightedInstalls += (item.installs24h || 0) * weight;
      current.scoreSum += item.score || 0;
      current.weightedScoreSum += (item.score || 0) * weight;
      current.weightSum += weight;
      groups.set(item.key, current);
    }
  }

  const aggregated = [...groups.values()].map((entry) => ({
    ...entry.latest,
    daysSeen: entry.daysSeen,
    installsWindow: entry.installsWindow,
    weightedInstalls: round(entry.weightedInstalls, 1),
    avgDailyScore: round(entry.scoreSum / Math.max(entry.daysSeen, 1), 1),
    weightedDailyScore: round(entry.weightedScoreSum / Math.max(entry.weightSum, 1), 1),
    historyCoverage: round(entry.daysSeen / Math.max(window.days, 1), 2),
    coverageGap: Math.max(window.days - entry.daysSeen, 0),
    rankDeltaWindow: (entry.earliest.rank || 0) - (entry.latest.rank || 0),
    trendDelta: round((entry.latest.score || 0) - (entry.earliest.score || 0), 1)
  }));

  const maxStars = Math.max(...aggregated.map((item) => item.stars || 0), 1);
  const normalized = aggregated.map((item) => {
    const starScore = logRatio(item.stars || 0, maxStars);
    const referenceScore = Math.min((item.references || 0) / 3, 1);
    const avgScore = (item.weightedDailyScore || item.avgDailyScore || 0) / 100;
    const observedInstallHeat = (item.installsWindow || 0) / Math.max(item.daysSeen || 1, 1);
    const observedCatalogHeat = catalogDailyEquivalent(item);
    const observedStarHeat = Math.sqrt(item.stars || 0) * (1.6 + referenceScore * 0.8);
    const observedDailyHeat = Math.max(observedInstallHeat, observedCatalogHeat, round(observedStarHeat, 1));
    const estimateFactor = clamp(
      period === "week"
        ? 0.3 + starScore * 0.48 + referenceScore * 0.14 + avgScore * 0.08
        : 0.24 + starScore * 0.56 + referenceScore * 0.12 + avgScore * 0.08,
      0.32,
      1
    );
    const projectedWindowHeat = round(item.installsWindow + observedDailyHeat * item.coverageGap * estimateFactor, 1);
    const estimateConfidence = estimationConfidence(item);
    const effectiveWindowHeat = round(item.installsWindow + (projectedWindowHeat - item.installsWindow) * estimateConfidence, 1);

    return {
      ...item,
      estimateFactor: round(estimateFactor, 2),
      estimationConfidence: estimateConfidence,
      observedDailyHeat: round(observedDailyHeat, 1),
      projectedWindowHeat,
      effectiveWindowHeat
    };
  });

  const maxProjectedHeat = Math.max(...normalized.map((item) => item.effectiveWindowHeat || item.projectedWindowHeat || item.weightedInstalls || 0), 1);
  const maxCatalog = Math.max(...normalized.map((item) => item.catalogInstalls || 0), 1);

  const ranked = normalized
    .map((item) => {
      const installScore = logRatio(item.effectiveWindowHeat || item.projectedWindowHeat || item.weightedInstalls || 0, maxProjectedHeat);
      const catalogScore = logRatio(item.catalogInstalls || 0, maxCatalog);
      const starScore = logRatio(item.stars || 0, maxStars);
      const coverageScore = clamp((item.historyCoverage || 0) * (item.estimationConfidence || 1), 0, 1);
      const referenceScore = Math.min((item.references || 0) / 3, 1);
      const avgScore = (item.weightedDailyScore || item.avgDailyScore || 0) / 100;
      const trendScore = momentumScore(item);
      const score = round(
        (
          installScore * weights.install +
          catalogScore * weights.catalog +
          starScore * weights.star +
          coverageScore * weights.coverage +
          referenceScore * weights.reference +
          avgScore * weights.avg +
          trendScore * weights.momentum
        ) * 100,
        1
      );

      return {
        ...item,
        score
      };
    })
    .sort((a, b) => b.score - a.score || (b.effectiveWindowHeat || b.projectedWindowHeat || 0) - (a.effectiveWindowHeat || a.projectedWindowHeat || 0))
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  return diversifySkillRankings(ranked, period);
}

export function buildRankings(snapshots, period = "day") {
  const resolvedPeriod = resolveLegacyPeriod(period);
  const currentWindow = buildLegacyWindow(snapshots, resolvedPeriod, 0);
  const previousWindow = buildLegacyWindow(snapshots, resolvedPeriod, 1);

  const currentRankings = aggregateLegacyWindow(currentWindow, resolvedPeriod);
  const previousRankings = aggregateLegacyWindow(previousWindow, resolvedPeriod);
  const previousRankMap = new Map(previousRankings.map((item) => [item.key, item.rank]));

  return currentRankings.map((item) => ({
    ...item,
    movement: previousRankMap.has(item.key) ? previousRankMap.get(item.key) - item.rank : null
  }));
}

export function filterRankings(items, { query = "", source = "all", limit = 24 } = {}) {
  if (isExcludedQuery(query)) {
    return [];
  }

  const needle = slugify(query);
  const filtered = filterExcludedSkills(items).filter((item) => {
    if (source !== "all" && !item.sources?.[source]) {
      return false;
    }

    if (!needle) {
      return true;
    }

    const haystack = slugify(
      [
        item.name,
        item.skillId,
        item.owner,
        item.repoFullName,
        item.description,
        item.chineseIntro,
        ...(item.tags || [])
      ]
        .filter(Boolean)
        .join(" ")
    );

    return haystack.includes(needle);
  });

  return filtered.slice(0, limit).map((item, index) => ({
    ...item,
    rank: index + 1
  }));
}

export function summarizeRankings(items) {
  const sourceNames = uniq(items.flatMap((item) => Object.keys(item.sources || {})));
  return {
    skillCount: items.length,
    sourceCount: sourceNames.length,
    hottestSkill: items[0]?.name || "",
    topSources: sourceNames
  };
}

function mergeProjectSkill(existing, item) {
  const current = existing || {
    key: item.key,
    name: item.name,
    skillId: item.skillId,
    detailUrl: item.detailUrl,
    chineseIntro: item.chineseIntro || buildChineseIntro(item),
    installs24h: 0,
    catalogInstalls: 0,
    references: 0,
    score: 0,
    tags: [],
    sources: []
  };

  return {
    ...current,
    name: current.name || item.name,
    skillId: item.skillId || current.skillId,
    detailUrl: item.detailUrl || current.detailUrl,
    chineseIntro: current.chineseIntro || item.chineseIntro || buildChineseIntro(item),
    installs24h: Math.max(current.installs24h || 0, item.installs24h || 0),
    catalogInstalls: Math.max(current.catalogInstalls || 0, item.catalogInstalls || 0),
    references: Math.max(current.references || 0, item.references || 0),
    score: Math.max(current.score || 0, item.score || 0),
    tags: uniq([...(current.tags || []), ...(item.tags || [])]),
    sources: uniq([...(current.sources || []), ...Object.keys(item.sources || {})])
  };
}

function projectProxyDailyGrowth(project) {
  const catalogBoost = Math.sqrt(project.catalogInstallsMax || 0) * 0.14;
  const referenceBoost = (project.crossSourceCount || 0) * 2.2;
  const forkBoost = Math.sqrt(project.forks || 0) * 0.08;
  const updateBoost = recencyScore(project.pushedAt) * 8;
  return round(catalogBoost + referenceBoost + forkBoost + updateBoost, 1);
}

function projectConfidence(coverage) {
  if (coverage >= 1) {
    return 1;
  }

  return round(clamp(Math.sqrt(coverage) * 0.6, 0.12, 0.85), 2);
}

function buildProjectDescription(project) {
  const cleanDescription = decodeHtmlEntities(project.description || "");

  if (/[\u4e00-\u9fff]/.test(cleanDescription)) {
    return cleanDescription.trim();
  }

  if (cleanDescription) {
    return cleanDescription.trim();
  }

  return `${project.name || project.repoFullName} 是一个值得关注的 AI 开源项目。`;
}

function buildProjectRecommendation(project) {
  const cleanDescription = decodeHtmlEntities(project.description || "");
  const topicText = (project.topics || []).slice(0, 2).map((tag) => humanizeSlug(tag)).join("、");
  const skillText = (project.topSkills || []).slice(0, 2).map((skill) => skill.name).join("、");
  const targetText = topicText || skillText || "AI 开发、自动化与工具集成";
  const repoName = project.name || project.repo || project.repoFullName;
  const haystack = [project.repoFullName, cleanDescription, ...(project.topics || []), skillText].join(" ");
  const descSentence = cleanDescription
    ? `它的核心定位是：${cleanDescription.replace(/\.$/, "")}。`
    : `${repoName} 主要围绕 ${targetText} 方向构建完整能力。`;

  let functionSentence = `${repoName} 的主要功能是帮助用户更高效地完成 ${targetText} 相关工作，既可以作为独立工具使用，也可以接入现有研发、自动化或内容生产流程中。`;
  let sceneSentence = `${repoName} 适合需要稳定能力沉淀的团队与个人，尤其适用于想快速验证想法、减少重复操作、提升交付效率的场景。`;

  if (/browser/i.test(haystack)) {
    functionSentence = `${repoName} 的主要功能是提供面向 AI 与自动化任务的浏览器执行能力，能够处理页面打开、元素定位、交互操作、信息采集和流程回放等关键步骤，适合把网页任务接入 agent、脚本或数据流水线。`;
    sceneSentence = `${repoName} 特别适合浏览器自动化、网页测试、表单处理、页面抓取和 AI Agent 执行链路等场景，能够降低传统浏览器方案在速度、资源占用和集成复杂度上的成本。`;
  } else if (/agent|workflow|automation|mcp/i.test(haystack)) {
    functionSentence = `${repoName} 的主要功能是围绕智能体编排、工具调用与自动化执行建立统一能力层，通常会覆盖任务拆解、工具连接、上下文管理、流程串联和结果回收等环节，方便把复杂任务拆成可重复执行的模块。`;
    sceneSentence = `${repoName} 更适合需要多步骤协作、工作流自动化、MCP 集成或 Agent 工程化落地的团队，可以用来缩短从原型验证到稳定交付之间的实现路径。`;
  } else if (/design|ui|frontend/i.test(haystack)) {
    functionSentence = `${repoName} 的主要功能是帮助开发者提升界面设计、组件搭建与前端实现质量，通常会覆盖视觉规范、组件组合、界面打磨和交互细节优化等关键环节。`;
    sceneSentence = `${repoName} 适合前端工程、设计协作、原型实现和体验优化等场景，尤其适用于希望在较短时间内获得更稳定界面结果的团队。`;
  } else if (/data|database|search|memory/i.test(haystack)) {
    functionSentence = `${repoName} 的主要功能是围绕数据组织、检索、记忆或数据库能力提供更直接的工程支持，帮助用户更快完成信息存取、查询编排、上下文保持和结果复用。`;
    sceneSentence = `${repoName} 适合知识库、搜索增强、长期记忆、数据中台或应用后端等场景，能够在保证可扩展性的同时提升数据可用性与接入效率。`;
  }

  const closingSentence = skillText
    ? `如果结合它当前较受关注的能力点，例如 ${skillText}，会更容易理解这个项目在真实生产环境中的落地方式和扩展空间。`
    : `从现有公开信息来看，这个项目更强调可落地性与工程可用性，而不是单纯停留在概念演示层面。`;

  const recommendation = `${descSentence}${functionSentence}${sceneSentence}${closingSentence}`.replace(/\s+/g, " ").trim();
  if (recommendation.length >= 100) {
    return recommendation;
  }

  return `${recommendation}${repoName} 同时具备一定的可扩展空间，既能作为独立项目直接使用，也适合作为现有系统中的一个能力模块来集成。`;
}

function buildPreviewImageUrl(repoFullName) {
  if (!repoFullName) {
    return "";
  }

  return `https://opengraph.githubassets.com/1/${repoFullName}`;
}

function scoreProjectQuery(project, needle) {
  if (!needle) {
    return {
      score: 0,
      matchedSkills: project.topSkills || []
    };
  }

  const repoName = slugify(project.name);
  const repoFullName = slugify(project.repoFullName);
  const owner = slugify(project.owner);
  const description = slugify([project.descriptionZh, project.description, ...(project.topics || [])].filter(Boolean).join(" "));

  let score = 0;
  if (repoName === needle || repoFullName === needle || owner === needle) {
    score += 220;
  } else {
    if (repoFullName.includes(needle) || repoName.includes(needle) || owner.includes(needle)) {
      score += 140;
    }
    if (description.includes(needle)) {
      score += 65;
    }
  }

  const matchedSkills = [...(project.topSkills || [])]
    .map((skill) => {
      const skillName = slugify(skill.name);
      const skillHaystack = slugify([skill.name, skill.skillId, skill.chineseIntro, ...(skill.tags || [])].filter(Boolean).join(" "));
      let skillScore = 0;
      if (skillName === needle) {
        skillScore += 90;
      } else if (skillHaystack.includes(needle)) {
        skillScore += 40;
      }

      if (!skillScore) {
        return null;
      }

      return {
        ...skill,
        matchScore: skillScore
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.matchScore - a.matchScore || (b.score || 0) - (a.score || 0));

  if (matchedSkills.length) {
    score += matchedSkills[0].matchScore;
  }

  const topSkills = matchedSkills.length
    ? uniq([
        ...matchedSkills.map((skill) => skill.key),
        ...(project.topSkills || []).map((skill) => skill.key)
      ])
        .map((key) => [...matchedSkills, ...(project.topSkills || [])].find((skill) => skill.key === key))
        .filter(Boolean)
        .slice(0, 3)
    : (project.topSkills || []).slice(0, 3);

  return {
    score,
    matchedSkills: topSkills
  };
}

function aggregateProjects(window) {
  const filteredSnapshots = window.snapshots.map((snapshot) => ({
    ...snapshot,
    items: filterExcludedSkills(snapshot.items || [])
  }));

  if (!filteredSnapshots.length) {
    return [];
  }

  const projectGroups = new Map();
  const sortedSnapshots = [...filteredSnapshots].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const snapshot of sortedSnapshots) {
    const repoDailyMap = new Map();

    for (const item of snapshot.items) {
      const repoFullName = normalizeRepoFullName(item.repoFullName, item.owner, item.repo);
      if (!repoFullName) {
        continue;
      }

      const current = repoDailyMap.get(repoFullName) || {
        repoFullName,
        owner: item.owner || repoFullName.split("/")[0] || "",
        repo: item.repo || repoFullName.split("/")[1] || "",
        name: humanizeSlug(item.repo || repoFullName.split("/")[1] || item.name),
        repoUrl: item.repoUrl || (repoFullName ? `https://github.com/${repoFullName}` : null),
        homepage: item.homepage || "",
        description: item.description || "",
        language: item.language || "",
        pushedAt: item.pushedAt || null,
        stars: 0,
        forks: 0,
        installs24h: 0,
        catalogInstallsMax: 0,
        sourceNames: [],
        topics: [],
        skills: []
      };

      current.name = current.name || humanizeSlug(item.repo || item.name);
      current.description = current.description || item.description || "";
      current.language = current.language || item.language || "";
      current.repoUrl = current.repoUrl || item.repoUrl || null;
      current.homepage = current.homepage || item.homepage || "";
      current.pushedAt =
        !current.pushedAt || new Date(item.pushedAt || 0).getTime() > new Date(current.pushedAt || 0).getTime() ? item.pushedAt || current.pushedAt : current.pushedAt;
      current.stars = Math.max(current.stars, item.stars || 0);
      current.forks = Math.max(current.forks, item.forks || 0);
      current.installs24h += item.installs24h || 0;
      current.catalogInstallsMax = Math.max(current.catalogInstallsMax, item.catalogInstalls || 0);
      current.sourceNames = uniq([...(current.sourceNames || []), ...Object.keys(item.sources || {})]);
      current.topics = uniq([...(current.topics || []), ...(item.tags || [])]);
      current.skills.push(item);
      repoDailyMap.set(repoFullName, current);
    }

    for (const daily of repoDailyMap.values()) {
      const project = projectGroups.get(daily.repoFullName) || {
        repoFullName: daily.repoFullName,
        owner: daily.owner,
        repo: daily.repo,
        name: daily.name,
        repoUrl: daily.repoUrl,
        homepage: daily.homepage,
        language: daily.language,
        description: daily.description,
        pushedAt: daily.pushedAt,
        forks: 0,
        stars: 0,
        earliestStars: null,
        latestStars: 0,
        observedDays: 0,
        installsWindow: 0,
        weightedActivity: 0,
        catalogInstallsMax: 0,
        sourceNames: [],
        topics: [],
        skillsMap: new Map(),
        earliestSnapshotAt: snapshot.createdAt,
        latestSnapshotAt: snapshot.createdAt
      };

      const snapshotTime = new Date(snapshot.createdAt).getTime();
      const ageDays = Math.max(0, Math.round((window.endTime - snapshotTime) / DAY_MS));
      const weight = recencyWeight(ageDays, window.days);

      project.name = project.name || daily.name;
      project.repoUrl = project.repoUrl || daily.repoUrl;
      project.description = project.description || daily.description;
      project.language = project.language || daily.language;
      project.homepage = project.homepage || daily.homepage;
      project.pushedAt =
        !project.pushedAt || new Date(daily.pushedAt || 0).getTime() > new Date(project.pushedAt || 0).getTime() ? daily.pushedAt || project.pushedAt : project.pushedAt;
      project.forks = Math.max(project.forks, daily.forks || 0);
      project.stars = Math.max(project.stars, daily.stars || 0);
      project.latestStars = Math.max(project.latestStars || 0, daily.stars || 0);
      project.earliestStars = project.earliestStars === null ? daily.stars || 0 : Math.min(project.earliestStars, daily.stars || 0);
      project.observedDays += 1;
      project.installsWindow += daily.installs24h || 0;
      project.weightedActivity += Math.max(daily.installs24h || 0, round((daily.catalogInstallsMax || 0) / 30, 1)) * weight;
      project.catalogInstallsMax = Math.max(project.catalogInstallsMax, daily.catalogInstallsMax || 0);
      project.sourceNames = uniq([...(project.sourceNames || []), ...(daily.sourceNames || [])]);
      project.topics = uniq([...(project.topics || []), ...(daily.topics || [])]);
      project.earliestSnapshotAt =
        snapshotTime < new Date(project.earliestSnapshotAt).getTime() ? snapshot.createdAt : project.earliestSnapshotAt;
      project.latestSnapshotAt =
        snapshotTime > new Date(project.latestSnapshotAt).getTime() ? snapshot.createdAt : project.latestSnapshotAt;

      for (const skill of daily.skills) {
        project.skillsMap.set(skill.key, mergeProjectSkill(project.skillsMap.get(skill.key), skill));
      }

      projectGroups.set(daily.repoFullName, project);
    }
  }

  return [...projectGroups.values()].map((project) => {
    const skillList = [...project.skillsMap.values()]
      .sort((a, b) => (b.installs24h || b.catalogInstalls || b.score || 0) - (a.installs24h || a.catalogInstalls || a.score || 0))
      .slice(0, 3);
    const historyCoverage = round(project.observedDays / Math.max(window.days, 1), 2);
    const growthConfidence = projectConfidence(historyCoverage);
    const starDeltaObserved = Math.max(0, (project.latestStars || project.stars || 0) - (project.earliestStars || 0));
    const coverageGap = Math.max(window.days - project.observedDays, 0);
    const proxyDailyGrowth = projectProxyDailyGrowth(project);
    const projectedStarDelta = round(starDeltaObserved + proxyDailyGrowth * coverageGap, 1);
    const effectiveStarDelta = round(
      starDeltaObserved + (projectedStarDelta - starDeltaObserved) * growthConfidence,
      1
    );

    const baseProject = {
      repoFullName: project.repoFullName,
      owner: project.owner,
      repo: project.repo,
      name: project.name || humanizeSlug(project.repo),
      repoUrl: project.repoUrl || `https://github.com/${project.repoFullName}`,
      homepage: project.homepage,
      language: project.language,
      description: project.description,
      topics: project.topics,
      pushedAt: project.pushedAt,
      stars: project.latestStars || project.stars || 0,
      forks: project.forks || 0,
      crossSourceCount: (project.sourceNames || []).length,
      sourceNames: project.sourceNames || [],
      skillCount: project.skillsMap.size,
      installsWindow: round(project.installsWindow, 1),
      weightedActivity: round(project.weightedActivity, 1),
      observedDays: project.observedDays,
      coverageGap,
      historyCoverage,
      growthConfidence,
      starDeltaObserved,
      proxyDailyGrowth,
      projectedStarDelta,
      effectiveStarDelta,
      trendStars: effectiveStarDelta,
      catalogInstallsMax: project.catalogInstallsMax,
      topSkills: skillList
    };

    return {
      ...baseProject,
      descriptionZh: buildProjectDescription(baseProject),
      recommendationZh: buildProjectRecommendation(baseProject),
      previewImageUrl: buildPreviewImageUrl(baseProject.repoFullName)
    };
  });
}

export function buildProjectWindowMeta(snapshots, window = "7d") {
  const resolvedWindow = resolveProjectWindow(window);
  const windowData = buildProjectWindow(snapshots, resolvedWindow, 0);
  const requiredDays = PROJECT_WINDOW_DAYS[resolvedWindow];
  const observedDays = countObservedDays(windowData.snapshots);
  const coverage = round(observedDays / Math.max(requiredDays, 1), 2);

  return {
    window: resolvedWindow,
    requiredDays,
    observedDays,
    coverage,
    isEstimated: resolvedWindow === "7d" && observedDays < requiredDays,
    label: resolvedWindow === "1d" ? "日推荐" : "周推荐"
  };
}

export function buildProjectRankings(snapshots, window = "7d") {
  const resolvedWindow = resolveProjectWindow(window);
  const currentWindow = buildProjectWindow(snapshots, resolvedWindow, 0);
  const previousWindow = buildProjectWindow(snapshots, resolvedWindow, 1);

  const currentProjects = aggregateProjects(currentWindow);
  if (!currentProjects.length) {
    return [];
  }

  const previousProjects = aggregateProjects(previousWindow);
  const previousRanked = rankProjects(previousProjects, resolvedWindow, []);
  const previousRankMap = new Map(previousRanked.map((item) => [item.repoFullName, item.rank]));
  const ranked = rankProjects(currentProjects, resolvedWindow, previousProjects);

  return ranked.map((item) => ({
    ...item,
    movement: previousRankMap.has(item.repoFullName) ? previousRankMap.get(item.repoFullName) - item.rank : null
  }));
}

function rankProjects(projects, window, previousProjects = []) {
  if (window === "1d") {
    return rankDailyProjects(projects, previousProjects);
  }

  return rankWeeklyProjects(projects);
}

function rankDailyProjects(projects, previousProjects = []) {
  if (!projects.length) {
    return [];
  }

  const previousMap = new Map(previousProjects.map((item) => [item.repoFullName, item]));
  const ranked = projects.map((project) => {
    const previous = previousMap.get(project.repoFullName);
    const observedTrend = previous ? Math.max(0, (project.stars || 0) - (previous.stars || 0)) : 0;
    const proxyTrend = round(project.proxyDailyGrowth * 0.42, 1);
    const trendStars = observedTrend || proxyTrend;
    const growthConfidence = previous ? 1 : round(clamp((project.growthConfidence || 0.25) * 0.75, 0.18, 0.55), 2);

    return {
      ...project,
      trendStars,
      starDeltaObserved: observedTrend,
      projectedStarDelta: observedTrend || proxyTrend,
      effectiveStarDelta: previous ? observedTrend : round(proxyTrend * growthConfidence, 1),
      growthConfidence
    };
  });

  const maxTrend = Math.max(...ranked.map((item) => item.effectiveStarDelta || item.trendStars || 0), 1);
  const maxActivity = Math.max(...ranked.map((item) => item.weightedActivity || 0), 1);
  const maxStars = Math.max(...ranked.map((item) => item.stars || 0), 1);

  return diversifyProjectRankings(
    ranked
      .map((project) => {
        const trendScore = logRatio(project.effectiveStarDelta || project.trendStars || 0, maxTrend);
        const activityScore = logRatio(project.weightedActivity || 0, maxActivity);
        const sourceScore = clamp((project.crossSourceCount || 0) / 4, 0, 1);
        const starScaleScore = logRatio(project.stars || 0, maxStars);
        const codeUpdateScore = recencyScore(project.pushedAt);
        const growthScore = round((trendScore * 0.58 + activityScore * 0.18 + sourceScore * 0.12 + starScaleScore * 0.07 + codeUpdateScore * 0.05) * 100, 1);

        return {
          ...project,
          growthScore,
          recommendationZh: buildProjectRecommendation(project)
        };
      })
      .sort((a, b) => b.growthScore - a.growthScore || b.effectiveStarDelta - a.effectiveStarDelta || b.stars - a.stars)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }))
  );
}

function rankWeeklyProjects(projects) {
  if (!projects.length) {
    return [];
  }

  const maxEffectiveDelta = Math.max(...projects.map((item) => item.effectiveStarDelta || 0), 1);
  const maxActivity = Math.max(...projects.map((item) => item.weightedActivity || 0), 1);
  const maxSkills = Math.max(...projects.map((item) => item.skillCount || 0), 1);
  const maxStars = Math.max(...projects.map((item) => item.stars || 0), 1);

  const ranked = projects.map((project) => {
    const starGrowthScore = logRatio(project.effectiveStarDelta || 0, maxEffectiveDelta);
    const activityScore = logRatio(project.weightedActivity || 0, maxActivity);
    const sourceScore = clamp((project.crossSourceCount || 0) / 4, 0, 1);
    const breadthScore = logRatio(project.skillCount || 0, maxSkills);
    const starScaleScore = logRatio(project.stars || 0, maxStars);
    const codeUpdateScore = recencyScore(project.pushedAt);
    const growthScore = round(
      (
        starGrowthScore * PROJECT_GROWTH_WEIGHTS.starGrowth +
        activityScore * PROJECT_GROWTH_WEIGHTS.activity +
        sourceScore * PROJECT_GROWTH_WEIGHTS.source +
        breadthScore * PROJECT_GROWTH_WEIGHTS.breadth +
        starScaleScore * PROJECT_GROWTH_WEIGHTS.stars +
        codeUpdateScore * PROJECT_GROWTH_WEIGHTS.codeUpdate
      ) * 100,
      1
    );

    return {
      ...project,
      growthScore,
      trendStars: project.effectiveStarDelta
    };
  });

  return diversifyProjectRankings(ranked);
}

export function filterProjectRankings(items, { query = "", limit = 24 } = {}) {
  if (isExcludedQuery(query)) {
    return [];
  }

  const needle = slugify(query);
  const filtered = items
    .filter((item) => !isExcludedRepo(item.repoFullName, item.owner, item.repo))
    .map((item) => {
      const { score, matchedSkills } = scoreProjectQuery(item, needle);
      return {
        ...item,
        queryScore: score,
        matchedSkills
      };
    })
    .filter((item) => !needle || item.queryScore > 0)
    .sort((a, b) => {
      if (needle && b.queryScore !== a.queryScore) {
        return b.queryScore - a.queryScore;
      }

      return b.growthScore - a.growthScore || b.effectiveStarDelta - a.effectiveStarDelta;
    })
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  return filtered.map((item) => ({
    ...item,
    topSkills: (item.matchedSkills || item.topSkills || []).slice(0, 3)
  }));
}

export function summarizeProjectRankings(items) {
  const totalSkills = items.reduce((sum, item) => sum + (item.skillCount || 0), 0);
  return {
    projectCount: items.length,
    totalSkills,
    hottestProject: items[0]?.repoFullName || "",
    fastestGrowth: items[0]?.trendStars || 0
  };
}
