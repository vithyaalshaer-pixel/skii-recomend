const state = {
  window: "7d",
  items: [],
  windowMeta: null
};

const WINDOW_META = {
  "1d": {
    title: "GitHub AI 开源项目日推荐",
    shortLabel: "日推荐"
  },
  "7d": {
    title: "GitHub AI 开源项目周推荐",
    shortLabel: "周推荐"
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCount(value) {
  if (!value) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
}

function setHeadline(text) {
  elements.statusHeadline.textContent = text;
}

function currentMeta(payload) {
  return payload?.windowMeta || state.windowMeta || {
    window: state.window,
    requiredDays: state.window === "1d" ? 1 : 7,
    observedDays: 1,
    coverage: 1,
    isEstimated: false,
    label: state.window === "1d" ? "日推荐" : "周推荐"
  };
}

function renderHeader(meta) {
  const view = WINDOW_META[state.window];
  elements.headlineTitle.textContent = view.title;
  elements.resultTitle.textContent = view.shortLabel;
  elements.headlineSubtitle.textContent = "按趋势 Star、活跃度与跨来源信号生成推荐，已全局排除 OpenClaw。";
  elements.resultNote.textContent =
    state.window === "7d" && meta.isEstimated
      ? `当前为预估周推荐，真实快照 ${meta.observedDays}/${meta.requiredDays} 天。`
      : `${view.shortLabel}基于当前窗口内已观测到的 GitHub 趋势信号生成。`;
  elements.resultMeta.textContent = `覆盖 ${Math.round((meta.coverage || 0) * 100)}%`;
}

function renderStatus(payload) {
  elements.statusRefresh.textContent = `最近刷新：${formatDate(payload.generatedAt)}`;
  elements.statusNext.textContent = `下次刷新：${formatDate(payload.nextRefreshAt)}`;
}

function renderCards(meta) {
  renderHeader(meta);
  elements.resultCount.textContent = `${state.items.length} 个项目`;

  if (!state.items.length) {
    elements.resultsList.innerHTML = '<div class="empty-state">当前没有可展示的推荐项目，请稍后刷新。</div>';
    return;
  }

  elements.resultsList.innerHTML = state.items
    .map((item) => {
      const tags = (item.topics || []).slice(0, 4);
      return `
        <article class="recommend-card">
          <div class="recommend-title">
            <span class="title-bar"></span>
            <h3>${item.rank}. ${escapeHtml(item.repoFullName)}</h3>
          </div>

          <div class="recommend-body">
            <div class="info-list">
              <div class="info-row">
                <span class="info-icon">•</span>
                <span class="info-label">项目名称:</span>
                <span class="info-value">${escapeHtml(item.repoFullName)}</span>
              </div>
              <div class="info-row">
                <span class="info-icon">•</span>
                <span class="info-label">项目地址:</span>
                <a class="info-link" href="${escapeHtml(item.repoUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.repoUrl || "")}</a>
              </div>
              <div class="info-row">
                <span class="info-icon">•</span>
                <span class="info-label">当前 Star 数:</span>
                <span class="info-value">${formatCount(item.stars)}</span>
              </div>
              <div class="info-row">
                <span class="info-icon">•</span>
                <span class="info-label">趋势 Star 数:</span>
                <span class="info-value">${formatCount(item.trendStars)}</span>
              </div>
              <div class="info-row info-row-block">
                <span class="info-icon">•</span>
                <span class="info-label">项目介绍:</span>
                <span class="info-value info-paragraph">${escapeHtml(item.descriptionZh || item.description)}</span>
              </div>
              <div class="info-row">
                <span class="info-icon">•</span>
                <span class="info-label">项目标签:</span>
                <span class="tag-list">${tags.length ? tags.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("") : '<span class="tag-empty">暂无标签</span>'}</span>
              </div>
              <div class="info-row info-row-block">
                <span class="info-icon">•</span>
                <span class="info-label">推荐语:</span>
                <span class="info-value info-paragraph">${escapeHtml(item.recommendationZh)}</span>
              </div>
            </div>

            <a class="preview-frame" href="${escapeHtml(item.repoUrl || "#")}" target="_blank" rel="noreferrer">
              <img class="preview-image" data-preview-image src="${escapeHtml(item.previewImageUrl || "")}" alt="${escapeHtml(item.repoFullName)} preview" />
              <div class="preview-fallback">
                <strong>${escapeHtml(item.repoFullName)}</strong>
                <span>${escapeHtml(item.description || item.descriptionZh || "")}</span>
              </div>
            </a>
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
        image.closest(".preview-frame")?.classList.add("is-fallback");
      },
      { once: true }
    );
  });
}

async function fetchProjects() {
  setHeadline("正在生成推荐列表…");
  const params = new URLSearchParams({
    window: state.window,
    limit: "15"
  });

  const response = await fetch(`/api/projects?${params.toString()}`);
  const payload = await response.json();
  const meta = currentMeta(payload);
  state.items = payload.items || [];
  state.windowMeta = meta;

  renderCards(meta);
  renderStatus(payload);
  setHeadline(meta.isEstimated ? `已完成加载，当前为预估${meta.label}。` : `已完成加载，当前为${meta.label}。`);
}

async function triggerRefresh() {
  elements.refreshButton.disabled = true;
  setHeadline("正在刷新抓取源，请稍候…");
  await fetch("/api/refresh", { method: "POST" });
  await fetchProjects();
  elements.refreshButton.disabled = false;
}

elements.windowTabs.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-window]");
  if (!target) {
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
