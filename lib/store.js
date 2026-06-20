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
  blog: "trend:blog",
  cafe: "trend:cafe",
  yt_videos: "trend:yt_videos",
  yt_snapshots: "trend:yt_snapshots",
  yt_keyword: "trend:yt_keyword",
  config: "trend:config",
  meta: "trend:meta"
};

const DEFAULT_SETTINGS = {
  collect_times: ["09:00", "15:00", "21:00"],
  timezone: "Asia/Seoul",
  google_trends: { geo: "KR", rss_url: "https://trends.google.com/trending/rss?geo=KR" },
  trends24: { region: "korea", url: "https://trends24.in/korea/", seoul_url: "https://trends24.in/korea/seoul/" },
  // 스팸 필터: mode=observe(분류만, 리포트엔 영향X) | enforce(리포트에서 제외)
  spam_filter: { mode: "observe", extra_terms: [], whitelist: [] },
  // 네이버 블로그·카페 검색 수집 설정
  naver_search: { enabled: true, max_keywords_per_run: 8, max_results_per_keyword: 30, sort: "date" },
  // 블로그/카페 검색에서 제외할 키워드(부분일치). 예: ["로또","날씨"]
  ignore_keywords: [],
  // YouTube 수집 설정
  youtube: {
    enabled: true,
    region_code: "KR",
    max_popular_videos: 50,
    keyword_search_enabled: true,
    max_keywords_per_run: 8,
    search_results_per_keyword: 10,
    search_order: "relevance",
    stopwords: ["공식", "실시간", "라이브", "풀영상", "shorts", "쇼츠", "다시보기", "하이라이트", "뉴스", "단독"]
  }
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

/* ---------- blog / cafe posts (link 기준 중복 방지) ---------- */
async function getBlog() { return await getArr(KEYS.blog); }
async function getCafe() { return await getArr(KEYS.cafe); }

async function addPosts(key, posts) {
  const all = await getArr(key);
  const seen = {};
  all.forEach(function (p) { if (p.link) seen[p.link] = true; });
  let added = 0;
  posts.forEach(function (p) {
    if (!p.link || seen[p.link]) return; // link unique
    seen[p.link] = true;
    p.id = uid();
    p.created_at = new Date().toISOString();
    all.push(p);
    added++;
  });
  await setArr(key, all);
  return added;
}
async function addBlogPosts(posts) { return await addPosts(KEYS.blog, posts); }
async function addCafePosts(posts) { return await addPosts(KEYS.cafe, posts); }

/* ---------- youtube ---------- */
async function getYtVideos() { return await getArr(KEYS.yt_videos); }
async function getYtSnapshots() { return await getArr(KEYS.yt_snapshots); }
async function getYtKeyword() { return await getArr(KEYS.yt_keyword); }

// 영상 기본정보: video_id unique, 있으면 last_seen/통계 갱신
async function upsertYtVideos(videos) {
  const all = await getArr(KEYS.yt_videos);
  const idx = {};
  all.forEach(function (v, i) { idx[v.video_id] = i; });
  const now = new Date().toISOString();
  let added = 0;
  videos.forEach(function (v) {
    if (idx[v.video_id] !== undefined) {
      const cur = all[idx[v.video_id]];
      cur.last_seen_at = now;
      cur.title = v.title; cur.channel_title = v.channel_title; cur.category_id = v.category_id;
      cur.thumbnail_url = v.thumbnail_url || cur.thumbnail_url;
    } else {
      all.push({
        video_id: v.video_id, title: v.title, normalized_title: v.normalized_title || "",
        description: v.description, channel_id: v.channel_id, channel_title: v.channel_title,
        category_id: v.category_id, published_at: v.published_at, duration: v.duration,
        thumbnail_url: v.thumbnail_url, video_url: v.video_url,
        first_seen_at: now, last_seen_at: now, id: uid(), created_at: now
      });
      idx[v.video_id] = all.length - 1;
      added++;
    }
  });
  await setArr(KEYS.yt_videos, all);
  return added;
}

// 통계 스냅샷: video_id + 시간버킷 + source_type(+keyword) 중복 방지
async function addYtSnapshots(snaps) {
  const all = await getArr(KEYS.yt_snapshots);
  const seen = {};
  all.forEach(function (s) { seen[s.video_id + "|" + hourBucket(s.collected_at) + "|" + s.source_type + "|" + (s.keyword || "")] = true; });
  let added = 0;
  snaps.forEach(function (s) {
    const k = s.video_id + "|" + hourBucket(s.collected_at) + "|" + s.source_type + "|" + (s.keyword || "");
    if (seen[k]) return;
    seen[k] = true;
    s.id = uid(); s.created_at = new Date().toISOString();
    all.push(s);
    added++;
  });
  await setArr(KEYS.yt_snapshots, all);
  return added;
}

// 키워드-영상 관계: keyword + video_id + 날짜 중복 방지
async function addYtKeyword(rows) {
  const all = await getArr(KEYS.yt_keyword);
  const seen = {};
  all.forEach(function (r) { seen[r.normalized_keyword + "|" + r.video_id + "|" + String(r.collected_at).slice(0, 10)] = true; });
  let added = 0;
  rows.forEach(function (r) {
    const k = r.normalized_keyword + "|" + r.video_id + "|" + String(r.collected_at).slice(0, 10);
    if (seen[k]) return;
    seen[k] = true;
    r.id = uid(); r.created_at = new Date().toISOString();
    all.push(r);
    added++;
  });
  await setArr(KEYS.yt_keyword, all);
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
    blog: await getArr(KEYS.blog),
    cafe: await getArr(KEYS.cafe),
    yt_videos: await getArr(KEYS.yt_videos),
    yt_snapshots: await getArr(KEYS.yt_snapshots),
    yt_keyword: await getArr(KEYS.yt_keyword),
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
  getBlog, getCafe, addBlogPosts, addCafePosts,
  getYtVideos, getYtSnapshots, getYtKeyword, upsertYtVideos, addYtSnapshots, addYtKeyword,
  exportAll
};
