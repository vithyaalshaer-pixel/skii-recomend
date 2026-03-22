import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectRankings, buildProjectWindowMeta, buildSnapshot, filterProjectRankings } from "../lib/scoring.js";
import { SkillService } from "../lib/service.js";

function buildSkill(overrides = {}) {
  const sources = overrides.sources || { "skills.sh": {}, github: {} };
  return {
    key: "example:skill",
    owner: "example",
    repoFullName: "example/agents",
    repo: "agents",
    name: "agent-core",
    skillId: "agent-core",
    installs24h: 1200,
    catalogInstalls: 8000,
    stars: 10000,
    forks: 800,
    references: Object.keys(sources).length,
    tags: ["agent"],
    description: "A practical agent framework.",
    repoUrl: "https://github.com/example/agents",
    detailUrl: "https://skills.sh/example/agents/agent-core",
    sources,
    ...overrides
  };
}

function buildDailySnapshot(date, items) {
  return buildSnapshot(items, date, []);
}

test("project rankings group skills by repo", () => {
  const snapshot = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "example:agent-core", name: "agent-core", skillId: "agent-core", installs24h: 5000 }),
    buildSkill({ key: "example:auto-research", name: "auto-research", skillId: "auto-research", installs24h: 4200 }),
    buildSkill({ key: "example:eval-suite", name: "eval-suite", skillId: "eval-suite", installs24h: 3200 }),
    buildSkill({
      key: "other:browser",
      owner: "other",
      repoFullName: "other/browser-ai",
      repo: "browser-ai",
      name: "browser",
      skillId: "browser",
      installs24h: 900,
      stars: 3000,
      repoUrl: "https://github.com/other/browser-ai",
      detailUrl: "https://skills.sh/other/browser-ai/browser"
    })
  ]);

  const rankings = buildProjectRankings([snapshot], "7d");
  const project = rankings.find((item) => item.repoFullName === "example/agents");

  assert.ok(project);
  assert.equal(project.skillCount, 3);
  assert.ok(project.recommendationZh.length >= 100);
  assert.ok(project.previewImageUrl.includes("opengraph.githubassets.com"));
});

test("project rankings exclude openclaw repos and queries", () => {
  const snapshot = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "obra:brainstorming", owner: "obra", repoFullName: "obra/superpowers", repo: "superpowers", name: "brainstorming" }),
    buildSkill({
      key: "openclaw:skill-creator",
      owner: "openclaw",
      repoFullName: "openclaw/skills",
      repo: "skills",
      name: "skill-creator",
      repoUrl: "https://github.com/openclaw/skills"
    })
  ]);

  const rankings = buildProjectRankings([snapshot], "7d");
  assert.equal(rankings.some((item) => item.repoFullName.includes("openclaw/")), false);
  assert.equal(filterProjectRankings(rankings, { query: "openclaw", limit: 24 }).length, 0);
});

test("project rankings use a real trailing seven day window", () => {
  const older = buildDailySnapshot("2026-03-01T08:00:00.000Z", [
    buildSkill({ key: "legacy:agent", owner: "legacy", repoFullName: "legacy/agent-kit", repo: "agent-kit", name: "agent-kit", stars: 1000 })
  ]);
  const latest = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "fresh:agent", owner: "fresh", repoFullName: "fresh/agent-kit", repo: "agent-kit", name: "agent-kit", stars: 4000 })
  ]);

  const rankings = buildProjectRankings([older, latest], "7d");
  assert.equal(rankings.length, 1);
  assert.equal(rankings[0].repoFullName, "fresh/agent-kit");
});

test("full seven day history prefers observed star growth", () => {
  const snapshots = Array.from({ length: 7 }, (_, index) =>
    buildDailySnapshot(`2026-03-${String(15 + index).padStart(2, "0")}T08:00:00.000Z`, [
      buildSkill({
        key: "agency:lead",
        owner: "agency",
        repoFullName: "agency/agents",
        repo: "agents",
        name: "lead",
        stars: 1000 + index * 15,
        installs24h: 2800 + index * 100,
        repoUrl: "https://github.com/agency/agents"
      })
    ])
  );

  const meta = buildProjectWindowMeta(snapshots, "7d");
  const rankings = buildProjectRankings(snapshots, "7d");

  assert.equal(meta.isEstimated, false);
  assert.equal(rankings[0].growthConfidence, 1);
  assert.equal(rankings[0].trendStars, 90);
});

test("sparse weekly history becomes estimated", () => {
  const snapshot = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "agency:lead", owner: "agency", repoFullName: "agency/agents", repo: "agents", name: "lead", stars: 10000 })
  ]);

  const meta = buildProjectWindowMeta([snapshot], "7d");
  const rankings = buildProjectRankings([snapshot], "7d");

  assert.equal(meta.isEstimated, true);
  assert.ok(rankings[0].growthConfidence < 1);
  assert.ok(rankings[0].trendStars > 0);
});

test("daily recommendation prefers 24 hour star delta", () => {
  const previous = buildDailySnapshot("2026-03-20T08:00:00.000Z", [
    buildSkill({ key: "light:browser", owner: "lightpanda-io", repoFullName: "lightpanda-io/browser", repo: "browser", name: "browser", stars: 18000 }),
    buildSkill({ key: "crosstalk:nomad", owner: "Crosstalk-Solutions", repoFullName: "Crosstalk-Solutions/project-nomad", repo: "project-nomad", name: "project-nomad", stars: 900 })
  ]);
  const latest = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "light:browser", owner: "lightpanda-io", repoFullName: "lightpanda-io/browser", repo: "browser", name: "browser", stars: 18475 }),
    buildSkill({ key: "crosstalk:nomad", owner: "Crosstalk-Solutions", repoFullName: "Crosstalk-Solutions/project-nomad", repo: "project-nomad", name: "project-nomad", stars: 1070 })
  ]);

  const rankings = buildProjectRankings([previous, latest], "1d");
  assert.equal(rankings[0].repoFullName, "lightpanda-io/browser");
  assert.equal(rankings[0].trendStars, 475);
});

test("service dashboard exposes the new public project fields and falls back to weekly window", () => {
  const snapshot = buildDailySnapshot("2026-03-21T08:00:00.000Z", [
    buildSkill({ key: "light:browser", owner: "lightpanda-io", repoFullName: "lightpanda-io/browser", repo: "browser", name: "browser", stars: 18475 })
  ]);

  const service = new SkillService({
    dataFile: "/tmp/unused-project-dashboard.json",
    githubToken: "",
    now: () => new Date("2026-03-21T08:00:00.000Z")
  });
  service.db = {
    snapshots: [snapshot],
    meta: {
      lastRefreshAt: "2026-03-21T08:00:00.000Z",
      nextRefreshAt: "2026-03-22T08:00:00.000Z",
      lastRefreshReason: "test",
      lastError: null,
      sourceStatus: []
    }
  };

  const payload = service.getProjectDashboard({ window: "14d", limit: 5 });

  assert.equal(payload.window, "7d");
  assert.equal(payload.windowMeta.label, "周推荐");
  assert.ok("trendStars" in payload.items[0]);
  assert.ok("recommendationZh" in payload.items[0]);
  assert.ok(payload.items[0].recommendationZh.length >= 100);
  assert.ok("previewImageUrl" in payload.items[0]);
  assert.equal("topSkills" in payload.items[0], false);
});
