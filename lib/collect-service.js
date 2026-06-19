/*
 * lib/collect-service.js — 수집 핵심 로직 (api/collect.js, api/cron.js 공용).
 * 20분 쿨다운으로 과도한 외부 요청을 방지한다.
 */
const store = require("./store");
const collectors = require("./collectors");
const { normalizeKeyword } = require("./normalize");

const COOLDOWN_MS = 20 * 60 * 1000;

function toSnapshot(source, it, region, now) {
  return {
    source: source,
    keyword: it.keyword,
    normalized_keyword: normalizeKeyword(it.keyword),
    rank: it.rank,
    score: null,
    metric_text: it.metric_text || "",
    region: region || it.region || "",
    category: "",
    collected_at: now,
    source_url: it.source_url || "",
    raw_data: JSON.stringify(it)
  };
}

async function runCollect(force) {
  const meta = await store.getMeta();
  const now = Date.now();
  if (!force && meta.last_collect_at && now - new Date(meta.last_collect_at).getTime() < COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown", last_collect_at: meta.last_collect_at };
  }

  const cfg = await store.getConfig();
  const settings = cfg.settings;
  const keywordGroups = cfg.keywords;
  const nowIso = new Date().toISOString();

  const [g, t, n] = await Promise.all([
    collectors.googleTrends(settings),
    collectors.trends24(settings),
    collectors.naverDatalab(settings, keywordGroups)
  ]);

  const log = [];

  const gSnaps = g.items.map(function (it) { return toSnapshot("google_trends", it, "KR", nowIso); });
  log.push({ source: "google_trends", message: g.message, added: await store.addSnapshots(gSnaps), mock: !!g.usedMock });

  const tSnaps = t.items.map(function (it) { return toSnapshot("trends24_x", it, it.region, nowIso); });
  log.push({ source: "trends24_x", message: t.message, added: await store.addSnapshots(tSnaps), mock: !!t.usedMock });

  await store.upsertCandidates(gSnaps.concat(tSnaps).map(function (s) {
    return { keyword: s.keyword, normalized_keyword: s.normalized_keyword, source: s.source };
  }));

  let nAdded = 0;
  if (n.items && n.items.length) nAdded = await store.addNaverResults(n.items);
  log.push({ source: "naver_datalab", message: n.message, added: nAdded, mock: !!n.usedMock });

  await store.setMeta(Object.assign({}, meta, { last_collect_at: nowIso }));
  return { collected_at: nowIso, log: log };
}

module.exports = { runCollect };
