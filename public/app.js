const state = {
  window: "7d",
  items: [],
  windowMeta: null
};

const WINDOW_META = {
  "1d": {
    title: "GitHub AI 开源项目日推荐",
    shortLabel: "日推荐",
    trendLabel: "24h 趋势"
  },
  "7d": {
    title: "GitHub AI 开源项目周推荐",
    shortLabel: "周推荐",
    trendLabel: "7 天趋势"
  }
};

const elements = {
  headlineTitle: document.getElementById("headline-title"),
  headlineSubtitle: document.getElementById("headline-subtitle"),
  windowTabs: document.getElementById("window-tabs"),
  refreshButton: document.getElementById("refresh-button"),
  statusHeadline: document.getElementById("status-headline"),
  statusRefresh: document.getElementById("status-refresh"),
  statusNext: document.getElementById("status-next"),
  resultTitle: document.getElementById("result-title"),
  resultNote: document.getElementById("result-note"),
  resultCount: document.getElementById("result-count"),
  resultMeta: document.getElementById("result-meta"),
  resultsList: document.getElementById("results-list")
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatMetric(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "0";
  }
  if (Math.abs(amount) >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}K`;
  }
  if (Math.abs(amount) >= 10 && Number.isInteger(amount)) {
    return String(amount);
  }
  if (Math.abs(amount) >= 10) {
    return amount.toFixed(1);
  }
  return amount.toFixed(amount >= 1 ? 1 : 2).replace(/\.0+$/, "");
}

function setHeadline(text) {
  elements.statusHeadline.textContent = text;
}

function currentMeta(payload) {
  return payload?.windowMeta || state.windowMeta || {
    window: state.window,
    requiredDays: state.window === "1d" ? 1 : 7,
    observedDays: 0,
    coverage: 0,
    isEstimated: state.window !== "1d",
    label: state.window === "1d" ? "日推荐" : "周推荐"
  };
}

function createTopicList(item, meta) {
  const topics = Array.isArray(item.topics) ? item.topics.filter(Boolean).slice(0, 4) : [];
  if (topics.length) {
    return topics;
  }
  return [meta.label, "AI Project", "可截图分享"];
}

function createNote(meta) {
  if (state.window === "7d" && meta.isEstimated) {
    return `当前为预估周推荐，真实快照 ${meta.observedDays}/${meta.requiredDays} 天，适合先看趋势方向。`;
  }
  return `${meta.label}按移动端海报版式重排，适合在 iPhone 上阅读，也适合直接截图分享。`;
}

function renderHeader(meta) {
  const view = WINDOW_META[state.window];
  elements.headlineTitle.textContent = view.title;
  elements.resultTitle.textContent = `${view.shortLabel}海报流`;
  elements.headlineSubtitle.textContent = "移动端优先的单列推荐卡，适合 iPhone 16 Pro 阅读与直接截图分享，已全局排除 OpenClaw。";
  elements.resultNote.textContent = createNote(meta);
  elements.resultMeta.textContent = `覆盖 ${Math.round((meta.coverage || 0) * 100)}%`;
}

function renderStatus(payload) {
  elements.statusRefresh.textContent = `最近刷新 ${formatDate(payload.generatedAt)}`;
  elements.statusNext.textContent = `下次刷新 ${formatDate(payload.nextRefreshAt)}`;
}

function renderCards(meta) {
  const view = WINDOW_META[state.window];
  renderHeader(meta);
  elements.resultCount.textContent = `${state.items.length} 张推荐卡`;

  if (!state.items.length) {
    elements.resultsList.innerHTML = '<div class="empty-state">当前还没有可截图分享的推荐卡，点一下刷新后再看。</div>';
    return;
  }

  elements.resultsList.innerHTML = state.items
    .map((item) => {
      const tags = createTopicList(item, meta);
      const windowLabel = state.window === "7d" && meta.isEstimated ? "预估周推荐" : view.shortLabel;
      return `
        <article class="recommend-card">
          <div class="card-topline">
            <span class="rank-chip">#${item.rank}</span>
            <span class="window-chip">${windowLabel}</span>
          </div>

          <div class="recommend-main">
            <div class="recommend-copy">
              <p class="repo-kicker">GITHUB PROJECT</p>
              <h3 class="recommend-name">${escapeHtml(item.repoFullName)}</h3>
              <p class="recommend-summary">${escapeHtml(item.descriptionZh || item.description || "暂无项目介绍")}</p>
              <a class="repo-link" href="${escapeHtml(item.repoUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.repoUrl || "")}</a>
            </div>

            <a class="preview-card" href="${escapeHtml(item.repoUrl || "#")}" target="_blank" rel="noreferrer">
              <img class="preview-image" data-preview-image src="${escapeHtml(item.previewImageUrl || "")}" alt="${escapeHtml(item.repoFullName)} preview" />
              <div class="preview-fallback">
                <strong>${escapeHtml(item.repoFullName)}</strong>
                <span>${escapeHtml(item.descriptionZh || item.description || "")}</span>
              </div>
            </a>
          </div>

          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">当前 Star</span>
              <strong class="metric-value">${formatMetric(item.stars)}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">${view.trendLabel}</span>
              <strong class="metric-value">${formatMetric(item.trendStars)}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">榜单窗口</span>
              <strong class="metric-value">${windowLabel}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">快照覆盖</span>
              <strong class="metric-value">${Math.round((meta.coverage || 0) * 100)}%</strong>
            </div>
          </div>

          <div class="tag-strip">
            ${tags.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
          </div>

          <div class="recommend-panel">
            <div class="panel-head">
              <strong>主要功能</strong>
              <span class="panel-note">截图友好版式</span>
            </div>
            <p class="recommend-text">${escapeHtml(item.recommendationZh || "暂无推荐语")}</p>
          </div>
        </article>
      `;
    })
    .join("");

  attachPreviewFallbacks();
}

function attachPreviewFallbacks() {
  elements.resultsList.querySelectorAll("[data-preview-image]").forEach((image) => {
    image.addEventListener(
      "error",
      () => {
        image.closest(".preview-card")?.classList.add("is-fallback");
      },
      { once: true }
    );
  });
}

async function fetchProjects() {
  setHeadline("正在生成适合截图的推荐卡…");
  const params = new URLSearchParams({
    window: state.window,
    limit: "10"
  });

  const response = await fetch(`/api/projects?${params.toString()}`);
  if (!response.ok) {
    throw new Error("推荐接口请求失败");
  }

  const payload = await response.json();
  const meta = currentMeta(payload);
  state.items = payload.items || [];
  state.windowMeta = meta;

  renderCards(meta);
  renderStatus(payload);
  setHeadline(meta.isEstimated ? `已加载完成，当前为${meta.label}海报卡。` : `已加载完成，当前为${meta.label}正式推荐。`);
}

async function triggerRefresh() {
  elements.refreshButton.disabled = true;
  setHeadline("正在刷新抓取源，请稍候…");
  const response = await fetch("/api/refresh", { method: "POST" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.details || payload.error || "刷新失败");
  }
  await fetchProjects();
  elements.refreshButton.disabled = false;
}

elements.windowTabs.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-window]");
  if (!target || target.dataset.window === state.window) {
    return;
  }

  state.window = target.dataset.window;
  elements.windowTabs.querySelectorAll(".window-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.window === state.window);
  });
  await fetchProjects();
});

elements.refreshButton.addEventListener("click", () => {
  triggerRefresh().catch((error) => {
    setHeadline(error.message || "刷新失败");
    elements.refreshButton.disabled = false;
  });
});

fetchProjects().catch((error) => {
  setHeadline(error.message || "加载失败");
});
