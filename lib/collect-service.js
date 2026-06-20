/*
 * lib/collect-service.js — 수집 핵심 로직 (api/collect.js, api/cron.js 공용).
 * 20분 쿨다운으로 과도한 외부 요청을 방지한다.
 */
const store = require("./store");
const collectors = require("./collectors");
const { normalizeKeyword } = require("./normalize");
const { filterKeywords } = require("./keyword_filter");

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

  // ----- 네이버 블로그·카페 검색 (Google Trends 키워드 기준) -----
  const ns = settings.naver_search || {};
  if (ns.enabled !== false) {
    try {
      const gKeywords = gSnaps.map(function (s) { return s.keyword; });
      const picked = filterKeywords(gKeywords, settings.ignore_keywords || [], ns.max_keywords_per_run || 8);
      const opts = { display: ns.max_results_per_keyword || 30, sort: ns.sort || "date" };

      let blogAdded = 0, cafeAdded = 0, blogMock = false, cafeMock = false;
      for (let i = 0; i < picked.length; i++) {
        const kw = picked[i];
        const nk = normalizeKeyword(kw);

        const b = await collectors.naverBlog(kw, opts);
        if (b.usedMock) blogMock = true;
        blogAdded += await store.addBlogPosts(b.items.map(function (it) {
          return { source: "naver_blog", keyword: kw, normalized_keyword: nk, title: it.title, description: it.description,
            link: it.link, bloggername: it.bloggername, bloggerlink: it.bloggerlink, postdate: it.postdate,
            collected_at: nowIso, raw_data: JSON.stringify(it) };
        }));

        const c = await collectors.naverCafe(kw, opts);
        if (c.usedMock) cafeMock = true;
        cafeAdded += await store.addCafePosts(c.items.map(function (it) {
          return { source: "naver_cafe", keyword: kw, normalized_keyword: nk, title: it.title, description: it.description,
            link: it.link, cafename: it.cafename, cafeurl: it.cafeurl,
            collected_at: nowIso, raw_data: JSON.stringify(it) };
        }));
      }
      log.push({ source: "naver_blog", message: "블로그 검색 " + picked.length + "개 키워드", added: blogAdded, mock: blogMock });
      log.push({ source: "naver_cafe", message: "카페 검색 " + picked.length + "개 키워드", added: cafeAdded, mock: cafeMock });
    } catch (e) {
      // 블로그/카페 실패가 전체 수집을 막지 않도록 격리
      log.push({ source: "naver_search", message: "블로그/카페 수집 오류: " + e.message, added: 0, mock: false });
    }
  }

  await store.setMeta(Object.assign({}, meta, { last_collect_at: nowIso }));
  return { collected_at: nowIso, log: log };
}

module.exports = { runCollect };
