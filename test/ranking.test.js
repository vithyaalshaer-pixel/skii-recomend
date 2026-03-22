import test from "node:test";
import assert from "node:assert/strict";
import { buildPeriodMeta, buildRankings, buildSnapshot } from "../lib/scoring.js";

test("weekly rankings aggregate installs and preserve movement", () => {
  const first = buildSnapshot(
    [
      {
        key: "anthropics:frontend-design",
        owner: "anthropics",
        repoFullName: "anthropics/skills",
        repo: "skills",
        name: "frontend-design",
        skillId: "frontend-design",
        installs24h: 2000,
        stars: 18000,
        references: 3,
        tags: ["frontend"],
        sources: { "skills.sh": {}, github: {} }
      },
      {
        key: "vercel:cache-components",
        owner: "vercel",
        repoFullName: "vercel/next.js",
        repo: "next.js",
        name: "cache-components",
        skillId: "cache-components",
        installs24h: 1500,
        stars: 130000,
        references: 2,
        tags: ["next"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-20T08:00:00.000Z",
    []
  );

  const second = buildSnapshot(
    [
      {
        key: "anthropics:frontend-design",
        owner: "anthropics",
        repoFullName: "anthropics/skills",
        repo: "skills",
        name: "frontend-design",
        skillId: "frontend-design",
        installs24h: 2600,
        stars: 18000,
        references: 3,
        tags: ["frontend"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const rankings = buildRankings([first, second], "week");
  assert.equal(rankings[0].key, "anthropics:frontend-design");
  assert.equal(rankings[0].daysSeen, 2);
  assert.equal(rankings[0].installsWindow, 4600);
});

test("weekly rankings use a trailing seven-day window", () => {
  const older = buildSnapshot(
    [
      {
        key: "legacy:old-skill",
        owner: "legacy",
        repoFullName: "legacy/skills",
        repo: "skills",
        name: "old-skill",
        skillId: "old-skill",
        installs24h: 9000,
        stars: 9000,
        references: 2,
        tags: ["legacy"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-01T08:00:00.000Z",
    []
  );

  const latest = buildSnapshot(
    [
      {
        key: "fresh:new-skill",
        owner: "fresh",
        repoFullName: "fresh/skills",
        repo: "skills",
        name: "new-skill",
        skillId: "new-skill",
        installs24h: 1200,
        stars: 2000,
        references: 2,
        tags: ["fresh"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const rankings = buildRankings([older, latest], "week");
  assert.equal(rankings.length, 1);
  assert.equal(rankings[0].key, "fresh:new-skill");
});

test("weekly rankings are not forced to match daily order", () => {
  const snapshot = buildSnapshot(
    [
      {
        key: "trend:flash",
        owner: "trend",
        repoFullName: "trend/skills",
        repo: "skills",
        name: "flash",
        skillId: "flash",
        installs24h: 50000,
        stars: 50,
        references: 1,
        tags: ["trend"],
        sources: { "skills.sh": {}, github: {} }
      },
      {
        key: "stable:evergreen",
        owner: "stable",
        repoFullName: "stable/skills",
        repo: "skills",
        name: "evergreen",
        skillId: "evergreen",
        installs24h: 120,
        stars: 100000,
        references: 1,
        tags: ["stable"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const daily = buildRankings([snapshot], "day");
  const weekly = buildRankings([snapshot], "week");

  assert.equal(daily[0].key, "trend:flash");
  assert.equal(weekly[0].key, "stable:evergreen");
});

test("week and month expose different period heat from day values when history is sparse", () => {
  const snapshot = buildSnapshot(
    [
      {
        key: "stable:planner",
        owner: "stable",
        repoFullName: "stable/skills",
        repo: "skills",
        name: "planner",
        skillId: "planner",
        installs24h: 1000,
        stars: 90000,
        references: 3,
        tags: ["planner"],
        sources: { "skills.sh": {}, github: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const daily = buildRankings([snapshot], "day")[0];
  const weekly = buildRankings([snapshot], "week")[0];
  const monthly = buildRankings([snapshot], "month")[0];

  assert.equal(daily.projectedWindowHeat, 1000);
  assert.ok(weekly.projectedWindowHeat > daily.projectedWindowHeat);
  assert.ok(monthly.projectedWindowHeat > weekly.projectedWindowHeat);
});

test("period heat falls back to star-derived momentum when installs are missing", () => {
  const snapshot = buildSnapshot(
    [
      {
        key: "react:extract-errors",
        owner: "facebook",
        repoFullName: "facebook/react",
        repo: "react",
        name: "extract-errors",
        skillId: "extract-errors",
        installs24h: 0,
        stars: 242571,
        references: 1,
        tags: ["react"],
        sources: { agentskillsrepo: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const weekly = buildRankings([snapshot], "week")[0];
  const monthly = buildRankings([snapshot], "month")[0];

  assert.ok(weekly.projectedWindowHeat > 0);
  assert.ok(monthly.projectedWindowHeat > weekly.projectedWindowHeat);
  assert.ok(weekly.effectiveWindowHeat < weekly.projectedWindowHeat);
  assert.ok(monthly.effectiveWindowHeat < monthly.projectedWindowHeat);
});

test("daily rankings diversify repeated skills from the same repo cluster", () => {
  const snapshot = buildSnapshot(
    [
      {
        key: "microsoft:azure-storage",
        owner: "microsoft",
        repoFullName: "microsoft/azure-skills",
        repo: "azure-skills",
        name: "azure-storage",
        skillId: "azure-storage",
        installs24h: 4433,
        stars: 0,
        references: 1,
        tags: ["azure"],
        sources: { "skills.sh": {} }
      },
      {
        key: "microsoft:azure-ai",
        owner: "microsoft",
        repoFullName: "microsoft/azure-skills",
        repo: "azure-skills",
        name: "azure-ai",
        skillId: "azure-ai",
        installs24h: 4433,
        stars: 0,
        references: 1,
        tags: ["azure"],
        sources: { "skills.sh": {} }
      },
      {
        key: "obra:brainstorming",
        owner: "obra",
        repoFullName: "obra/superpowers",
        repo: "superpowers",
        name: "brainstorming",
        skillId: "brainstorming",
        installs24h: 4300,
        catalogInstalls: 65400,
        stars: 0,
        references: 1,
        tags: ["planning"],
        sources: { "skills.sh": {}, "skills.sh-catalog": {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  assert.equal(snapshot.items[0].key, "obra:brainstorming");
  assert.equal(snapshot.items[1].key, "microsoft:azure-storage");
  assert.notEqual(snapshot.items[0].repoFullName, snapshot.items[1].repoFullName);
});

test("period meta marks sparse history as estimated", () => {
  const snapshot = buildSnapshot(
    [
      {
        key: "obra:brainstorming",
        owner: "obra",
        repoFullName: "obra/superpowers",
        repo: "superpowers",
        name: "brainstorming",
        skillId: "brainstorming",
        installs24h: 1458,
        catalogInstalls: 65400,
        stars: 102128,
        references: 3,
        tags: ["planning"],
        sources: { "skills.sh": {}, "skills.sh-catalog": {}, github: {} }
      }
    ],
    "2026-03-21T08:00:00.000Z",
    []
  );

  const dayMeta = buildPeriodMeta([snapshot], "day");
  const weekMeta = buildPeriodMeta([snapshot], "week");
  const monthMeta = buildPeriodMeta([snapshot], "month");

  assert.equal(dayMeta.isEstimated, false);
  assert.equal(weekMeta.isEstimated, true);
  assert.equal(monthMeta.isEstimated, true);
  assert.equal(weekMeta.observedDays, 1);
  assert.equal(monthMeta.requiredDays, 30);
});
