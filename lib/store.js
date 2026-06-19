/*
 * lib/store.js
 * Upstash Redis(KV) 기반 저장소. (SQLite 4개 테이블을 JSON 배열로 표현)
 *  - trend:snapshots / trend:naver / trend:reports / trend:candidates
 *  - trend:config (설정+키워드) / trend:meta (마지막 수집 시각 등)
 *
 * KV 미설정 시 STORAGE 에러를 던지고, API 핸들러가 503 으로 안내한다.
 */
const { Redis } = require("@upstash/redis");

const KEYS = {
  snapshots: "trend:snapshots",
  naver: "trend:naver",
  reports: "trend:reports",
  candidates: "trend:candidates",
  config: "trend:config",
  meta: "trend:meta"
};

const DEFAULT_SETTINGS = {
  collect_times: ["09:00", "15:00", "21:00"],
  timezone: "Asia/Seoul",
  google_trends: { geo: "KR", rss_url: "https://trends.google.com/trending/rss?geo=KR" },
  trends24: { region: "korea", url: "https://trends24.in/korea/", seoul_url: "https://trends24.in/korea/seoul/" },
  // 스팸 필터: mode=observe(분류만, 리포트엔 영향X) | enforce(리포트에서 제외)
  spam_filter: { mode: "observe", extra_terms: [], whitelist: [] }
};

const DEFAULT_KEYWORDS = [
  { groupName: "AI", keywords: ["AI", "챗GPT", "AI 영상", "생성형 AI"] },
  { groupName: "경제", keywords: ["금리", "환율", "공모주", "비트코인"] },
  { groupName: "생활", keywords: ["전기요금", "여름휴가", "장마", "다이어트"] }
];

let _redis;
function getRedis() {
  if (_redis !== undefined) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

function ensure() {
  const r = getRedis();
  if (!r) {
    const e = new Error("STORAGE_NOT_CONFIGURED: Upstash Redis(KV) 환경변수가 없습니다.");
    e.code = "STORAGE";
    throw e;
  }
  return r;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function hourBucket(iso) { return new Date(iso).toISOString().slice(0, 13); }

async function getArr(key) {
  const v = await ensure().get(key);
  return Array.isArray(v) ? v : [];
}
async function setArr(key, arr) { await ensure().set(key, arr); }
async function getObj(key, def) {
  const v = await ensure().get(key);
  return v && typeof v === "object" ? v : def;
}
async function setObj(key, obj) { await ensure().set(key, obj); }

/* ---------- config ---------- */
async function getConfig() {
  const c = await getObj(KEYS.config, null);
  if (!c) return { settings: clone(DEFAULT_SETTINGS), keywords: clone(DEFAULT_KEYWORDS) };
  return {
    settings: Object.assign(clone(DEFAULT_SETTINGS), c.settings || {}),
    keywords: Array.isArray(c.keywords) ? c.keywords : clone(DEFAULT_KEYWORDS)
  };
}
async function setConfig(cfg) { await setObj(KEYS.config, cfg); }

/* ---------- meta ---------- */
async function getMeta() { return await getObj(KEYS.meta, {}); }
async function setMeta(m) { await setObj(KEYS.meta, m); }

/* ---------- snapshots ---------- */
async function getSnapshots() { return await getArr(KEYS.snapshots); }
async function addSnapshots(snaps) {
  const all = await getArr(KEYS.snapshots);
  const seen = {};
  all.forEach(function (s) { seen[s.source + "|" + s.normalized_keyword + "|" + hourBucket(s.collected_at)] = true; });
  let added = 0;
  snaps.forEach(function (s) {
    const key = s.source + "|" + s.normalized_keyword + "|" + hourBucket(s.collected_at);
    if (seen[key]) return;
    seen[key] = true;
    s.id = uid();
    s.created_at = new Date().toISOString();
    all.push(s);
    added++;
  });
  await setArr(KEYS.snapshots, all);
  return added;
}

/* ---------- naver ---------- */
async function getNaver() { return await getArr(KEYS.naver); }
async function addNaverResults(rows) {
  const all = await getArr(KEYS.naver);
  const idx = {};
  all.forEach(function (r, i) { idx[r.group_name + "|" + r.date + "|" + r.time_unit] = i; });
  let added = 0;
  rows.forEach(function (r) {
    const key = r.group_name + "|" + r.date + "|" + r.time_unit;
    if (idx[key] !== undefined) {
      all[idx[key]].ratio = r.ratio;
      all[idx[key]].keyword_list = r.keyword_list;
      return;
    }
    r.id = uid();
    r.collected_at = r.collected_at || new Date().toISOString();
    r.created_at = new Date().toISOString();
    all.push(r);
    idx[key] = all.length - 1;
    added++;
  });
  await setArr(KEYS.naver, all);
  return added;
}

/* ---------- reports ---------- */
async function getReports() { return await getArr(KEYS.reports); }
async function addReport(report) {
  const all = await getArr(KEYS.reports);
  report.id = uid();
  report.created_at = new Date().toISOString();
  all.unshift(report);
  await setArr(KEYS.reports, all);
  return report;
}
async function deleteReport(id) {
  const all = (await getArr(KEYS.reports)).filter(function (r) { return r.id !== id; });
  await setArr(KEYS.reports, all);
}

/* ---------- candidates ---------- */
async function getCandidates() { return await getArr(KEYS.candidates); }
async function upsertCandidates(items) {
  const all = await getArr(KEYS.candidates);
  const now = new Date().toISOString();
  const index = {};
  all.forEach(function (c, i) { index[c.normalized_keyword] = i; });
  items.forEach(function (it) {
    const nk = it.normalized_keyword;
    if (!nk) return;
    if (index[nk] !== undefined) {
      const c = all[index[nk]];
      c.last_seen_at = now;
      c.seen_count = (c.seen_count || 0) + 1;
      if (c.sources.indexOf(it.source) === -1) c.sources.push(it.source);
    } else {
      all.push({
        id: uid(), keyword: it.keyword, normalized_keyword: nk,
        first_seen_at: now, last_seen_at: now, seen_count: 1,
        sources: [it.source], status: "new", memo: ""
      });
      index[nk] = all.length - 1;
    }
  });
  await setArr(KEYS.candidates, all);
}
async function updateCandidate(id, patch) {
  const all = await getArr(KEYS.candidates);
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) { Object.keys(patch).forEach(function (k) { all[i][k] = patch[k]; }); break; }
  }
  await setArr(KEYS.candidates, all);
}

async function exportAll() {
  return {
    snapshots: await getArr(KEYS.snapshots),
    naver: await getArr(KEYS.naver),
    reports: await getArr(KEYS.reports),
    candidates: await getArr(KEYS.candidates),
    config: await getConfig()
  };
}

module.exports = {
  KEYS, DEFAULT_SETTINGS, DEFAULT_KEYWORDS,
  isConfigured: function () { return !!getRedis(); },
  getConfig, setConfig, getMeta, setMeta,
  getSnapshots, addSnapshots,
  getNaver, addNaverResults,
  getReports, addReport, deleteReport,
  getCandidates, upsertCandidates, updateCandidate,
  exportAll
};
