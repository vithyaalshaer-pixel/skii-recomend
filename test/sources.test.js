import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentSkillsRepoTop, parseSkillsShOwnerCatalog, parseSkillsShRepoPage, parseSkillsShTrending } from "../lib/sources.js";
import { parseMetric } from "../lib/utils.js";

test("parseSkillsShTrending extracts leaderboard items", () => {
  const html = String.raw`<script>self.__next_f.push([1,"{\"source\":\"anthropics/skills\",\"skillId\":\"frontend-design\",\"name\":\"frontend-design\",\"installs\":3700},{\"source\":\"vercel-labs/next-skills\",\"skillId\":\"vercel-react-best-practices\",\"name\":\"vercel-react-best-practices\",\"installs\":3300}"])</script>`;
  const items = parseSkillsShTrending(html, 5);
  assert.equal(items.length, 2);
  assert.equal(items[0].repoFullName, "anthropics/skills");
  assert.equal(items[0].installs24h, 3700);
});

test("parseAgentSkillsRepoTop extracts cards", () => {
  const html = `
    <article class="skill-card">
      <a href="/skill/facebook/react-extract-errors" class="skill-name">extract-errors</a>
      <a href="/author/facebook" class="skill-author">@facebook</a>
      <p class="skill-description">Use when adding new error messages to React.</p>
      <span class="stat"><svg></svg>242,571</span>
      <span class="tag">javascript</span>
      <span class="tag">react</span>
    </article>
  `;

  const items = parseAgentSkillsRepoTop(html, 5);
  assert.equal(items.length, 1);
  assert.equal(items[0].owner, "facebook");
  assert.equal(items[0].stars, 242571);
  assert.deepEqual(items[0].tags, ["javascript", "react"]);
});

test("parseMetric understands compact K and M suffixes", () => {
  assert.equal(parseMetric("403.5K"), 403500);
  assert.equal(parseMetric("1.2M"), 1200000);
});

test("parseSkillsShOwnerCatalog extracts top repos", () => {
  const html = `
    <a href="/obra/superpowers">
      <h3>superpowers</h3>
      <span class="font-mono text-sm text-foreground">403.5K</span>
    </a>
    <a href="/obra/episodic-memory">
      <h3>episodic-memory</h3>
      <span class="font-mono text-sm text-foreground">6.9K</span>
    </a>
  `;

  const items = parseSkillsShOwnerCatalog(html, "obra", 5);
  assert.equal(items.length, 2);
  assert.equal(items[0].repoFullName, "obra/superpowers");
  assert.equal(items[0].installsTotal, 403500);
});

test("parseSkillsShRepoPage extracts repo skills with installs", () => {
  const html = `
    <a href="/obra/superpowers/brainstorming">
      <h3>brainstorming</h3>
      <span class="font-mono text-sm text-foreground">65.4K</span>
    </a>
    <a href="/obra/superpowers/writing-plans">
      <h3>writing-plans</h3>
      <span class="font-mono text-sm text-foreground">34.2K</span>
    </a>
  `;

  const items = parseSkillsShRepoPage(html, "obra", "superpowers", 5);
  assert.equal(items.length, 2);
  assert.equal(items[0].key, "obra:brainstorming");
  assert.equal(items[0].installsTotal, 65400);
});
