const DATA_URL = "./data/polls.json";
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const state = {
  snapshot: null,
  search: "",
  sort: {
    key: "publishedAt",
    direction: "desc"
  }
};

const refs = {
  statusGrid: document.querySelector("#status-grid"),
  warningBanner: document.querySelector("#warning-banner"),
  tableBody: document.querySelector("#poll-table-body"),
  searchInput: document.querySelector("#search-input"),
  refreshButton: document.querySelector("#refresh-button"),
  lastUpdated: document.querySelector("#last-updated"),
  sortButtons: Array.from(document.querySelectorAll("th button[data-sort]"))
};

function escapeHtml(value = "") {
  return String(value)
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

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function metricValue(metric) {
  return metric && typeof metric.value === "number" ? metric.value : Number.NEGATIVE_INFINITY;
}

function readPath(record, path) {
  return path.split(".").reduce((current, key) => current?.[key], record);
}

function compareRecords(left, right) {
  const { key, direction } = state.sort;
  const leftValue = readPath(left, key);
  const rightValue = readPath(right, key);

  let result = 0;

  if (leftValue && typeof leftValue === "object" && "value" in leftValue) {
    result = metricValue(leftValue) - metricValue(rightValue);
  } else if (/date/i.test(key)) {
    result = new Date(leftValue || 0).getTime() - new Date(rightValue || 0).getTime();
  } else {
    result = String(leftValue || "").localeCompare(String(rightValue || ""), "en", {
      numeric: true,
      sensitivity: "base"
    });
  }

  return direction === "asc" ? result : result * -1;
}

function filterRecords(records) {
  if (!state.search) {
    return records;
  }

  const needle = state.search.toLowerCase();
  return records.filter((record) => {
    const haystack = [
      record.pollster,
      record.sourceName,
      record.headline,
      record.summary,
      record.notes
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function renderMetricCell(metric) {
  if (!metric) {
    return '<span class="metric-pill neutral">N/A</span>';
  }

  return `<span class="metric-pill success">${escapeHtml(metric.display)}</span>`;
}

function renderSourceCell(record) {
  const badgeClass = record.validation?.ok ? "valid" : "warning";
  const badgeLabel = record.validation?.ok ? "Link OK" : "Needs review";

  return `
    <div class="source-cell">
      <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(record.sourceName)}</a>
      <div class="source-meta">
        <span class="source-badge ${badgeClass}">${badgeLabel}</span>
        <span>${escapeHtml(record.headline || record.summary || "")}</span>
      </div>
    </div>
  `;
}

function renderStatusCards(metadata) {
  const cards = [
    {
      label: "Tracked polls",
      value: metadata?.totals?.polls ?? 0,
      foot: "Rows currently shown in the table."
    },
    {
      label: "Validated links",
      value: metadata?.totals?.validatedLinks ?? 0,
      foot: "Source URLs that passed the latest validation check."
    },
    {
      label: "Auto-discovered",
      value: metadata?.totals?.autoDiscovered ?? 0,
      foot: "Rows found by the scheduled ingestion pipeline."
    },
    {
      label: "Sources scanned",
      value: metadata?.articlesScanned ?? 0,
      foot: "Candidate articles scanned during the latest run."
    }
  ];

  refs.statusGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="status-card">
          <p class="metric-label">${escapeHtml(card.label)}</p>
          <p class="metric-value">${escapeHtml(card.value)}</p>
          <p class="metric-foot">${escapeHtml(card.foot)}</p>
        </article>
      `
    )
    .join("");
}

function renderTable() {
  const records = filterRecords([...(state.snapshot?.polls || [])]).sort(compareRecords);

  if (!records.length) {
    refs.tableBody.innerHTML = `
      <tr>
        <td colspan="11" class="loading-cell">No poll rows match the current filter.</td>
      </tr>
    `;
    return;
  }

  refs.tableBody.innerHTML = records
    .map(
      (record) => `
        <tr>
          <td>${escapeHtml(formatDate(record.pollDate))}</td>
          <td>
            <strong>${escapeHtml(record.pollster || "-")}</strong>
            <div class="source-meta">${escapeHtml(record.sourceCategory || "")}</div>
          </td>
          <td>${renderMetricCell(record.seatProjection?.dmk)}</td>
          <td>${renderMetricCell(record.seatProjection?.bjpAlliance)}</td>
          <td>${renderMetricCell(record.seatProjection?.tvk)}</td>
          <td>${renderMetricCell(record.seatProjection?.aiadmk)}</td>
          <td>${renderMetricCell(record.voteShare?.dmk)}</td>
          <td>${renderMetricCell(record.voteShare?.bjpAlliance)}</td>
          <td>${renderMetricCell(record.voteShare?.tvk)}</td>
          <td>${renderMetricCell(record.voteShare?.aiadmk)}</td>
          <td>${renderSourceCell(record)}</td>
        </tr>
      `
    )
    .join("");
}

function renderWarning(metadata) {
  if (!metadata?.warning) {
    refs.warningBanner.classList.add("hidden");
    refs.warningBanner.textContent = "";
    return;
  }

  refs.warningBanner.classList.remove("hidden");
  refs.warningBanner.textContent = metadata.warning;
}

function renderLastUpdated(metadata) {
  refs.lastUpdated.textContent = `Last successful update: ${formatDateTime(metadata?.lastSuccessfulUpdate)}`;
}

function renderSortState() {
  for (const button of refs.sortButtons) {
    const baseLabel = button.dataset.baseLabel || button.textContent.replace(/\s[\^v]$/, "");
    button.dataset.baseLabel = baseLabel;
    const isActive = button.dataset.sort === state.sort.key;
    const arrow = isActive ? (state.sort.direction === "asc" ? " ^" : " v") : "";
    button.textContent = `${baseLabel}${arrow}`;
  }
}

function render() {
  const metadata = state.snapshot?.metadata || {};
  renderStatusCards(metadata);
  renderWarning(metadata);
  renderLastUpdated(metadata);
  renderSortState();
  renderTable();
}

async function loadSnapshot() {
  refs.refreshButton.disabled = true;
  refs.refreshButton.textContent = "Refreshing...";

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Snapshot request failed with ${response.status}`);
    }

    state.snapshot = await response.json();
    render();
  } catch (error) {
    refs.warningBanner.classList.remove("hidden");
    refs.warningBanner.textContent = error instanceof Error ? error.message : "Unable to load the latest poll snapshot.";
  } finally {
    refs.refreshButton.disabled = false;
    refs.refreshButton.textContent = "Refresh snapshot";
  }
}

refs.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  renderTable();
});

refs.refreshButton.addEventListener("click", () => {
  loadSnapshot();
});

for (const button of refs.sortButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sort.key === key) {
      state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
    } else {
      state.sort.key = key;
      state.sort.direction = key === "pollDate" ? "desc" : "asc";
    }
    render();
  });
}

loadSnapshot();
setInterval(loadSnapshot, AUTO_REFRESH_MS);
