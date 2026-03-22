import {
  buildPeriodMeta,
  buildProjectRankings,
  buildProjectWindowMeta,
  buildRankings,
  buildSnapshot,
  filterProjectRankings,
  filterRankings,
  summarizeProjectRankings,
  summarizeRankings
} from "./scoring.js";
import { fetchHotSkillSources } from "./sources.js";
import { createFileDatabaseAdapter, upsertSnapshot } from "./storage.js";
import { clamp, formatDateKey, parseInteger } from "./utils.js";

export class SkillService {
  constructor({ dataFile, storageAdapter, githubToken, refreshIntervalHours = 24, now = () => new Date(), enableSchedule = true }) {
    this.dataFile = dataFile;
    this.storageAdapter = storageAdapter || createFileDatabaseAdapter(dataFile);
    this.githubToken = githubToken;
    this.refreshIntervalMs = clamp(refreshIntervalHours, 1, 168) * 3_600_000;
    this.now = now;
    this.enableSchedule = enableSchedule;
    this.db = null;
    this.refreshPromise = null;
    this.timer = null;
  }

  async init() {
    this.db = await this.storageAdapter.read();
    if (this.enableSchedule) {
      this.schedule();
    }
  }

  async reload() {
    this.db = await this.storageAdapter.read();
  }

  schedule() {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.refresh({ reason: "scheduled" }).catch((error) => {
        this.db.meta.lastError = error.message;
      });
    }, this.refreshIntervalMs);
  }

  async ensureFreshData() {
    const today = formatDateKey(this.now());
    const latestSnapshot = this.db.snapshots.at(-1);
    if (!latestSnapshot || latestSnapshot.dateKey !== today) {
      await this.refresh({ reason: "startup" });
    }
  }

  async refresh({ force = false, reason = "manual" } = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const today = formatDateKey(this.now());
    const latestSnapshot = this.db.snapshots.at(-1);
    if (!force && latestSnapshot?.dateKey === today) {
      return {
        skipped: true,
        snapshot: latestSnapshot,
        sourceStatus: this.db.meta.sourceStatus || []
      };
    }

    this.refreshPromise = this.#runRefresh(reason).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async #runRefresh(reason) {
    const createdAt = this.now().toISOString();
    const result = await fetchHotSkillSources({ githubToken: this.githubToken });
    const snapshot = buildSnapshot(result.items, createdAt, result.sourceStatus);

    this.db = upsertSnapshot(this.db, snapshot, {
      lastRefreshAt: createdAt,
      lastRefreshReason: reason,
      nextRefreshAt: new Date(new Date(createdAt).getTime() + this.refreshIntervalMs).toISOString(),
      lastError: null,
      sourceStatus: result.sourceStatus
    });

    await this.storageAdapter.write(this.db);

    return {
      skipped: false,
      snapshot,
      sourceStatus: result.sourceStatus
    };
  }

  getDashboard({ period = "day", query = "", source = "all", limit = 24 } = {}) {
    const periodMeta = buildPeriodMeta(this.db.snapshots, period);
    const rankings = buildRankings(this.db.snapshots, period);
    const items = filterRankings(rankings, {
      query,
      source,
      limit: clamp(parseInteger(limit, 24), 1, 60)
    });

    return {
      period,
      query,
      source,
      generatedAt: this.db.meta.lastRefreshAt,
      nextRefreshAt: this.db.meta.nextRefreshAt,
      sourceStatus: this.db.meta.sourceStatus || [],
      periodMeta,
      summary: summarizeRankings(items),
      items
    };
  }

  getProjectDashboard({ window = "7d", query = "", limit = 24 } = {}) {
    const windowMeta = buildProjectWindowMeta(this.db.snapshots, window);
    const rankings = buildProjectRankings(this.db.snapshots, window);
    const items = filterProjectRankings(rankings, {
      query,
      limit: clamp(parseInteger(limit, 24), 1, 60)
    }).map((item) => ({
      rank: item.rank,
      repoFullName: item.repoFullName,
      repoUrl: item.repoUrl,
      stars: item.stars,
      trendStars: item.trendStars || item.effectiveStarDelta || 0,
      description: item.description || "",
      descriptionZh: item.descriptionZh || "",
      topics: item.topics || [],
      recommendationZh: item.recommendationZh || "",
      previewImageUrl: item.previewImageUrl || ""
    }));

    return {
      window: windowMeta.window,
      query,
      generatedAt: this.db.meta.lastRefreshAt,
      nextRefreshAt: this.db.meta.nextRefreshAt,
      sourceStatus: this.db.meta.sourceStatus || [],
      windowMeta,
      summary: summarizeProjectRankings(items),
      items
    };
  }

  getStatus() {
    return {
      lastRefreshAt: this.db.meta.lastRefreshAt,
      lastRefreshReason: this.db.meta.lastRefreshReason,
      nextRefreshAt: this.db.meta.nextRefreshAt,
      lastError: this.db.meta.lastError,
      snapshotCount: this.db.snapshots.length,
      sourceStatus: this.db.meta.sourceStatus || []
    };
  }
}
