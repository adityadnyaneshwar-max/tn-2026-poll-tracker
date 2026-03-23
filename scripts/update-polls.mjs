import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "data", "source-manifest.json");
const MANUAL_POLLS_PATH = join(ROOT, "data", "manual-polls.json");
const OUTPUT_PATH = join(ROOT, "public", "data", "polls.json");
const OFFLINE_MODE = process.argv.includes("--offline");

const PARTY_ALIASES = {
  dmk: ["DMK", "DMK alliance", "DMK-led alliance", "DMK+"],
  bjpAlliance: [
    "BJP alliance",
    "BJP-led alliance",
    "NDA",
    "NDA alliance",
    "AIADMK-BJP alliance",
    "AIADMK-led alliance",
    "AIADMK alliance",
    "AIADMK+"
  ],
  tvk: ["TVK", "Vijay's TVK", "Tamizhaga Vettri Kazhagam"],
  aiadmk: ["AIADMK", "AIADMK-led", "AIADMK party"]
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureDirectory(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function safeReadOutput() {
  try {
    return loadJson(OUTPUT_PATH);
  } catch {
    return null;
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtml(text = "") {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€|â€/g, '"')
    .replace(/â€“|â€”|â€"/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/Â/g, "");
}

function stripTags(html = "") {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAllowedDomain(domain, manifest) {
  return manifest.allowedDomains.some((allowedDomain) => domain === allowedDomain || domain.endsWith(`.${allowedDomain}`));
}

function buildFeedUrls(query) {
  const encoded = encodeURIComponent(query);
  return [
    {
      provider: "google-news",
      url: `https://news.google.com/rss/search?q=${encoded}&hl=en-IN&gl=IN&ceid=IN:en`
    },
    {
      provider: "bing-news",
      url: `https://www.bing.com/news/search?q=${encoded}&format=rss`
    }
  ];
}

function resolveFeedLink(rawLink) {
  const link = decodeHtml(rawLink);

  try {
    const parsed = new URL(link);
    const hostname = parsed.hostname.replace(/^www\./, "");

    if (hostname.endsWith("bing.com") && parsed.pathname.includes("/news/apiclick.aspx")) {
      const targetUrl = parsed.searchParams.get("url");
      if (targetUrl) {
        return decodeURIComponent(targetUrl);
      }
    }

    return link;
  } catch {
    return link;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "tn-2026-poll-tracker/1.0",
        accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return {
      finalUrl: response.url,
      body: await response.text(),
      contentType: response.headers.get("content-type") || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateUrl(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": "tn-2026-poll-tracker/1.0"
      }
    });

    return {
      ok: response.ok,
      statusCode: response.status,
      checkedAt: new Date().toISOString(),
      mode: "live"
    };
  } catch {
    return {
      ok: false,
      statusCode: null,
      checkedAt: new Date().toISOString(),
      mode: "live"
    };
  }
}

function parseRssItems(xml, provider) {
  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

  for (const rawItem of matches) {
    const extract = (pattern) => {
      const match = rawItem.match(pattern);
      return match ? decodeHtml(match[1]).trim() : "";
    };

    const title = extract(/<title>([\s\S]*?)<\/title>/i);
    const link = resolveFeedLink(extract(/<link>([\s\S]*?)<\/link>/i));
    const pubDate = extract(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const description = extract(/<description>([\s\S]*?)<\/description>/i);
    const sourceName =
      extract(/<News:Source>([\s\S]*?)<\/News:Source>/i) ||
      extract(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const sourceUrl = extract(/<source[^>]*url="([^"]+)"/i);

    if (!title || !link) {
      continue;
    }

    items.push({
      provider,
      title,
      link,
      pubDate,
      description: stripTags(description),
      sourceName,
      sourceUrl: resolveFeedLink(sourceUrl)
    });
  }

  return items;
}

function normalizeMetric(metric, suffix = "") {
  if (metric === null || metric === undefined) {
    return null;
  }

  if (typeof metric === "object" && "value" in metric) {
    return metric;
  }

  return {
    value: Number(metric),
    display: suffix ? `${metric}${suffix}` : String(metric)
  };
}

function normalizePoll(poll) {
  const sourceUrl = poll.sourceUrl || poll.link || "";
  const sourceDomain = poll.sourceDomain || getDomain(sourceUrl);
  const normalized = {
    ...poll,
    id:
      poll.id ||
      slugify([
        poll.pollster,
        poll.pollDate || poll.publishedAt?.slice(0, 10),
        sourceDomain,
        sourceUrl
      ].join("-")),
    sourceUrl,
    sourceDomain,
    seatProjection: {
      dmk: normalizeMetric(poll.seatProjection?.dmk),
      bjpAlliance: normalizeMetric(poll.seatProjection?.bjpAlliance),
      tvk: normalizeMetric(poll.seatProjection?.tvk),
      aiadmk: normalizeMetric(poll.seatProjection?.aiadmk)
    },
    voteShare: {
      dmk: normalizeMetric(poll.voteShare?.dmk, "%"),
      bjpAlliance: normalizeMetric(poll.voteShare?.bjpAlliance, "%"),
      tvk: normalizeMetric(poll.voteShare?.tvk, "%"),
      aiadmk: normalizeMetric(poll.voteShare?.aiadmk, "%")
    }
  };

  normalized.sortDate = normalized.publishedAt || normalized.pollDate || "";
  return normalized;
}

function pickPollster(text, manifest) {
  for (const pollster of manifest.pollsters) {
    if (pollster.aliases.some((alias) => text.toLowerCase().includes(alias.toLowerCase()))) {
      return pollster.name;
    }
  }

  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias) {
  return `(?<![A-Za-z])${escapeRegex(alias)}(?![A-Za-z])`;
}

function createMetric(match) {
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  const value = end === null ? start : Number(((start + end) / 2).toFixed(2));
  const display = end === null ? `${start}` : `${start}-${end}`;

  return {
    value,
    display
  };
}

function extractPercent(text, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(
      `${aliasPattern(alias)}[^.%\\d]{0,60}(\\d{1,3}(?:\\.\\d+)?)(?:\\s*[-–]\\s*(\\d{1,3}(?:\\.\\d+)?))?\\s*(?:%|per\\s+cent|percent)`,
      "i"
    );
    const match = text.match(pattern);
    if (match) {
      const metric = createMetric(match);
      return metric
        ? {
            value: metric.value,
            display: `${metric.display}%`
          }
        : null;
    }
  }

  return null;
}

function extractSeats(text, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(
      `${aliasPattern(alias)}[^\\d]{0,60}(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?\\s+seats?`,
      "i"
    );
    const match = text.match(pattern);
    if (match) {
      return createMetric(match);
    }
  }

  return null;
}

function extractMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapeRegex(key)}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapeRegex(key)}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapeRegex(key)}["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegex(key)}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return decodeHtml(match[1]).trim();
    }
  }

  return "";
}

function extractDescriptionMeta(html) {
  const candidates = [
    extractMetaContent(html, "description"),
    extractMetaContent(html, "og:description"),
    extractMetaContent(html, "twitter:description")
  ].filter(Boolean);

  return candidates[0] || "";
}

function isPollLike(text) {
  return /tamil nadu/i.test(text) && /(survey|opinion poll|pre poll|tracker|state vibe|vote vibe|parawheel|c-voter|axis my india|matrize|ians)/i.test(text);
}

function countSignals(poll) {
  let count = 0;
  for (const metricGroup of [poll.seatProjection, poll.voteShare]) {
    for (const metric of Object.values(metricGroup)) {
      if (metric && typeof metric.value === "number" && Number.isFinite(metric.value)) {
        count += 1;
      }
    }
  }
  return count;
}

function isCandidateItemLikelyPoll(item, manifest) {
  const previewText = [item.title, item.description, item.sourceName].filter(Boolean).join(" ");
  const hintedDomain = getDomain(item.sourceUrl || item.link);
  const hintedPollster = pickPollster(previewText, manifest);

  return (
    isPollLike(previewText) &&
    (!hintedDomain || isAllowedDomain(hintedDomain, manifest) || Boolean(hintedPollster))
  );
}

function buildFocusedArticleText(item, metaDescription, visibleText) {
  const anchors = [item.title, metaDescription].filter(Boolean);

  for (const anchor of anchors) {
    const normalizedAnchor = stripTags(anchor).slice(0, 120);
    const startIndex = normalizedAnchor ? visibleText.indexOf(normalizedAnchor) : -1;
    if (startIndex >= 0) {
      return visibleText.slice(startIndex, startIndex + 5000);
    }
  }

  return visibleText.slice(0, 5000);
}

async function buildPollFromItem(item, manifest) {
  const resolved = await fetchText(item.link);
  const sourceUrl = resolved.finalUrl || item.link;
  const hintedSourceUrl = item.sourceUrl || sourceUrl;
  const sourceDomain = getDomain(hintedSourceUrl);
  const resolvedDomain = getDomain(sourceUrl);

  if (item.provider === "google-news" && resolvedDomain === "news.google.com") {
    return null;
  }

  if (!isAllowedDomain(sourceDomain, manifest)) {
    return null;
  }

  if (/application\/pdf/i.test(resolved.contentType) || /\.pdf(?:$|\?)/i.test(sourceUrl)) {
    return null;
  }

  const visibleText = stripTags(resolved.body);
  const metaDescription = extractDescriptionMeta(resolved.body);
  const focusedText = buildFocusedArticleText(item, metaDescription, visibleText);
  const combinedText = [item.title, item.description, metaDescription, focusedText].filter(Boolean).join(" ");

  if (!isPollLike(combinedText)) {
    return null;
  }

  const validation = await validateUrl(sourceUrl);
  if (!validation.ok) {
    return null;
  }

  const poll = normalizePoll({
    pollDate: item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pollster: pickPollster(combinedText, manifest) || item.sourceName || "Unattributed Survey",
    sourceName: item.sourceName || sourceDomain,
    sourceCategory: /thanthitv|news7tamil|puthiyathalaimurai|tv9tamil|polimer|dtnext|dinamani/i.test(sourceDomain)
      ? "local"
      : "national",
    sourceUrl: hintedSourceUrl || sourceUrl,
    sourceDomain,
    headline: item.title,
    summary: metaDescription || item.description || item.title,
    seatProjection: {
      dmk: extractSeats(combinedText, PARTY_ALIASES.dmk),
      bjpAlliance: extractSeats(combinedText, PARTY_ALIASES.bjpAlliance),
      tvk: extractSeats(combinedText, PARTY_ALIASES.tvk),
      aiadmk: extractSeats(combinedText, PARTY_ALIASES.aiadmk)
    },
    voteShare: {
      dmk: extractPercent(combinedText, PARTY_ALIASES.dmk),
      bjpAlliance: extractPercent(combinedText, PARTY_ALIASES.bjpAlliance),
      tvk: extractPercent(combinedText, PARTY_ALIASES.tvk),
      aiadmk: extractPercent(combinedText, PARTY_ALIASES.aiadmk)
    },
    notes: "Auto-discovered from scheduled feed ingestion. Review alliance labels before republishing if a story only reports combined blocs.",
    validation,
    discovery: {
      method: item.provider,
      query: item.query || "",
      feedLink: item.link
    },
    confidence: "auto"
  });

  return countSignals(poll) >= 2 ? poll : null;
}

function dedupePolls(polls) {
  const seen = new Map();

  for (const poll of polls) {
    const signature = [
      poll.pollster,
      poll.pollDate,
      poll.voteShare?.dmk?.display || "",
      poll.voteShare?.bjpAlliance?.display || "",
      poll.voteShare?.tvk?.display || "",
      poll.voteShare?.aiadmk?.display || "",
      poll.seatProjection?.dmk?.display || "",
      poll.seatProjection?.bjpAlliance?.display || "",
      poll.seatProjection?.tvk?.display || "",
      poll.seatProjection?.aiadmk?.display || ""
    ].join("|");
    const key = `${signature}|${poll.sourceUrl}`;

    if (!seen.has(key)) {
      seen.set(key, poll);
    }
  }

  return Array.from(seen.values()).sort((left, right) => {
    return new Date(right.sortDate || 0).getTime() - new Date(left.sortDate || 0).getTime();
  });
}

async function discoverPolls(manifest) {
  const discoveredItems = [];
  const feedErrors = [];

  for (const query of manifest.queries) {
    for (const feed of buildFeedUrls(query)) {
      try {
        const response = await fetchText(feed.url);
        const items = parseRssItems(response.body, feed.provider).map((item) => ({ ...item, query }));
        discoveredItems.push(...items);
      } catch (error) {
        feedErrors.push({
          query,
          feed: feed.provider,
          message: error instanceof Error ? error.message : "Unknown feed error"
        });
      }
    }
  }

  const candidateItems = [];
  const seenLinks = new Set();

  for (const item of discoveredItems.filter((candidate) => isCandidateItemLikelyPoll(candidate, manifest))) {
    if (seenLinks.has(item.link)) {
      continue;
    }

    seenLinks.add(item.link);
    candidateItems.push(item);
  }

  const polls = [];
  const articleErrors = [];

  for (const item of candidateItems.slice(0, 60)) {
    try {
      const poll = await buildPollFromItem(item, manifest);
      if (poll) {
        polls.push(poll);
      }
    } catch (error) {
      articleErrors.push({
        link: item.link,
        title: item.title,
        message: error instanceof Error ? error.message : "Unknown article error"
      });
    }
  }

  return {
    polls,
    feedErrors,
    articleErrors,
    articlesScanned: candidateItems.length
  };
}

async function main() {
  const manifest = loadJson(MANIFEST_PATH);
  const manualPolls = loadJson(MANUAL_POLLS_PATH).map(normalizePoll);
  const previousSnapshot = safeReadOutput();
  const previousPolls = (previousSnapshot?.polls || []).map(normalizePoll);
  const now = new Date().toISOString();

  let liveDiscovery = {
    polls: [],
    feedErrors: [],
    articleErrors: [],
    articlesScanned: 0
  };

  if (!OFFLINE_MODE) {
    try {
      liveDiscovery = await discoverPolls(manifest);
    } catch (error) {
      liveDiscovery.articleErrors.push({
        link: "",
        title: "global-discovery-failure",
        message: error instanceof Error ? error.message : "Unknown discovery error"
      });
    }
  }

  const usingCachedData = !OFFLINE_MODE && liveDiscovery.polls.length === 0 && previousPolls.length > 0;
  const mergedPolls = dedupePolls(
    usingCachedData
      ? [...manualPolls, ...previousPolls]
      : [...manualPolls, ...liveDiscovery.polls]
  );
  const hadErrors = OFFLINE_MODE || liveDiscovery.feedErrors.length > 0 || liveDiscovery.articleErrors.length > 0;
  const lastSuccessfulUpdate =
    !OFFLINE_MODE && liveDiscovery.polls.length > 0
      ? now
      : previousSnapshot?.metadata?.lastSuccessfulUpdate || now;

  const snapshot = {
    metadata: {
      tracker: "Tamil Nadu 2026 Assembly Poll Tracker",
      generatedAt: now,
      lastAttemptAt: now,
      lastSuccessfulUpdate,
      usingCachedData,
      hadErrors,
      fetchMode: OFFLINE_MODE ? "manual-only" : usingCachedData ? "cached" : "live+manual",
      warning:
        OFFLINE_MODE
          ? "This snapshot was built in offline mode, so only the verified seed records are included."
          : usingCachedData
            ? "Live fetching returned no fresh polls during the last run, so the tracker is showing the last cached snapshot plus verified seed records."
            : liveDiscovery.feedErrors.length || liveDiscovery.articleErrors.length
              ? "Some source checks failed during the last run. Cached entries remain available and validated rows stay visible."
              : null,
      totals: {
        polls: mergedPolls.length,
        sources: new Set(mergedPolls.map((poll) => poll.sourceDomain)).size,
        validatedLinks: mergedPolls.filter((poll) => poll.validation?.ok).length,
        manualSeeds: manualPolls.length,
        autoDiscovered: liveDiscovery.polls.length
      },
      sourcesChecked: manifest.allowedDomains.length,
      articlesScanned: liveDiscovery.articlesScanned,
      activeQueries: manifest.queries,
      sourceFailures: [...liveDiscovery.feedErrors, ...liveDiscovery.articleErrors]
    },
    polls: mergedPolls
  };

  ensureDirectory(OUTPUT_PATH);
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${snapshot.polls.length} poll rows to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
