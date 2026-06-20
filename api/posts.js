/*
 * GET /api/posts?type=blog|cafe|news&keyword=...&from=&to=  글 목록(키워드/기간 필터)
 * GET /api/posts?summary=1&from=&to=                키워드별 요약(블로그/카페 점수)
 * GET /api/posts?realtime=1                          실시간 네이버 확산 감지(블로그/카페/뉴스 신규수 + 상태)
 * GET /api/posts?realtime=1&keyword=...              키워드 실시간 상세(대표 제목 + 콘텐츠 아이디어)
 */
const store = require("../lib/store");
const report = require("../lib/report");
const analyze = require("../lib/analyze");
const { normalizeKeyword } = require("../lib/normalize");
const { json, handleError } = require("../lib/http");

function rangeFromQuery(q) {
  const to = q.to || report.todayKst();
  const from = q.from || report.kstDateStr(Date.now() - 7 * 86400000);
  return { from: from, to: to };
}
function inRange(p, from, to) {
  const d = report.kstDateStr(p.collected_at);
  return d >= from && d <= to;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    const q = req.query || {};
    const r = rangeFromQuery(q);

    if (q.realtime) {
      const now = Date.now();
      const H1 = 3600e3, H6 = 6 * 3600e3, H24 = 24 * 3600e3;
      const within = function (iso, ms) { return now - new Date(iso).getTime() <= ms; };

      const gsnaps = (await store.getSnapshots()).filter(function (s) { return s.source === "google_trends" && within(s.collected_at, H24); });
      const blogAll = await store.getBlog(), cafeAll = await store.getCafe(), newsAll = await store.getNews();

      const byKw = {};
      function bk(kw, nk) {
        if (!byKw[nk]) byKw[nk] = { keyword: kw, normalized: nk, google: [], blog: [], cafe: [], news: [] };
        return byKw[nk];
      }
      gsnaps.forEach(function (s) { bk(s.keyword, s.normalized_keyword || normalizeKeyword(s.keyword)).google.push(s); });
      function attach(arr, field) {
        arr.forEach(function (p) {
          const nk = p.normalized_keyword || normalizeKeyword(p.keyword);
          if (byKw[nk] && within(p.collected_at, H24)) byKw[nk][field].push(p);
        });
      }
      attach(blogAll, "blog"); attach(cafeAll, "cafe"); attach(newsAll, "news");

      // 키워드 상세
      if (q.keyword) {
        const nk = normalizeKeyword(q.keyword);
        const b = byKw[nk] || { keyword: q.keyword, google: [], blog: [], cafe: [], news: [] };
        const a = analyze.analyzeKeyword(q.keyword, b.blog, b.cafe);
        const ideas = analyze.realtimeIdeas(q.keyword, b.blog, b.cafe, b.news);
        const gsorted = b.google.slice().sort(function (x, y) { return x.collected_at < y.collected_at ? -1 : 1; });
        let bestRank = null;
        b.google.forEach(function (s) { if (typeof s.rank === "number" && (bestRank === null || s.rank < bestRank)) bestRank = s.rank; });
        return json(res, 200, {
          ok: true, keyword: q.keyword,
          google: { first_seen: gsorted.length ? gsorted[0].collected_at : null, best_rank: bestRank, traffic_text: gsorted.length ? (gsorted[gsorted.length - 1].metric_text || "") : "" },
          blog: { count: b.blog.length, titles: b.blog.slice(0, 10).map(function (p) { return { title: p.title, link: p.link }; }), phrases: a.repeated_phrases },
          cafe: { count: b.cafe.length, titles: b.cafe.slice(0, 10).map(function (p) { return { title: p.title, link: p.link }; }), signals: a.cafe_signals },
          news: { count: b.news.length, titles: b.news.slice(0, 10).map(function (p) { return { title: p.title, link: p.link }; }), signal_count: analyze.newsSignalCount(b.news) },
          ideas: ideas
        });
      }

      // 실시간 표
      const rows = Object.keys(byKw).map(function (nk) {
        const b = byKw[nk];
        const cnt = function (arr, ms) { return arr.filter(function (p) { return within(p.collected_at, ms); }).length; };
        const blog24 = b.blog.length, cafe24 = b.cafe.length, news24 = b.news.length;
        const a = analyze.analyzeKeyword(b.keyword, b.blog, b.cafe);
        const status = analyze.classifySpread({ blogNew: blog24, cafeNew: cafe24, newsNew: news24, cafeSignals: a.cafe_signals });
        const all = b.blog.concat(b.cafe).concat(b.news).sort(function (x, y) { return x.collected_at < y.collected_at ? 1 : -1; });
        return {
          keyword: b.keyword, normalized: nk,
          blog_new: blog24, cafe_new: cafe24, news_new: news24,
          blog_1h: cnt(b.blog, H1), cafe_1h: cnt(b.cafe, H1), news_1h: cnt(b.news, H1),
          blog_6h: cnt(b.blog, H6), cafe_6h: cnt(b.cafe, H6), news_6h: cnt(b.news, H6),
          status: status, score: analyze.spreadScore({ blogNew: blog24, cafeNew: cafe24, newsNew: news24 }),
          latest_title: all.length ? all[0].title : "", recent_at: all.length ? all[0].collected_at : null
        };
      }).sort(function (a, b) { return b.score - a.score; });

      return json(res, 200, { ok: true, rows: rows });
    }

    if (q.summary) {
      const snaps = (await store.getSnapshots()).filter(function (s) { return s.source === "google_trends" && inRange(s, r.from, r.to); });
      const blog = (await store.getBlog()).filter(function (p) { return inRange(p, r.from, r.to); });
      const cafe = (await store.getCafe()).filter(function (p) { return inRange(p, r.from, r.to); });

      const byKw = {};
      function bucket(kw, nk) {
        if (!byKw[nk]) byKw[nk] = { keyword: kw, normalized: nk, google_seen: 0, best_rank: null, blog: [], cafe: [] };
        return byKw[nk];
      }
      snaps.forEach(function (s) {
        const nk = s.normalized_keyword || normalizeKeyword(s.keyword);
        const b = bucket(s.keyword, nk);
        b.google_seen++;
        if (typeof s.rank === "number" && (b.best_rank === null || s.rank < b.best_rank)) b.best_rank = s.rank;
      });
      blog.forEach(function (p) { bucket(p.keyword, p.normalized_keyword || normalizeKeyword(p.keyword)).blog.push(p); });
      cafe.forEach(function (p) { bucket(p.keyword, p.normalized_keyword || normalizeKeyword(p.keyword)).cafe.push(p); });

      const rows = Object.keys(byKw).map(function (nk) {
        const b = byKw[nk];
        const a = analyze.analyzeKeyword(b.keyword, b.blog, b.cafe);
        return {
          keyword: b.keyword, normalized: nk,
          google_seen: b.google_seen, best_rank: b.best_rank,
          blog_new: a.blog_new_count, cafe_new: a.cafe_new_count,
          blog_spread_score: a.blog_spread_score, cafe_reaction_score: a.cafe_reaction_score
        };
      });
      rows.sort(function (a, b) { return (b.blog_spread_score + b.cafe_reaction_score) - (a.blog_spread_score + a.cafe_reaction_score); });
      return json(res, 200, { ok: true, period: r, rows: rows });
    }

    // 키워드 상세: 블로그/카페/뉴스 목록
    const type = ["cafe", "news"].indexOf(q.type) !== -1 ? q.type : "blog";
    const all = type === "cafe" ? await store.getCafe() : type === "news" ? await store.getNews() : await store.getBlog();
    let posts = all.filter(function (p) { return inRange(p, r.from, r.to); });
    if (q.keyword) {
      const nk = normalizeKeyword(q.keyword);
      posts = posts.filter(function (p) { return (p.normalized_keyword || normalizeKeyword(p.keyword)) === nk; });
    }
    // 분석 신호도 함께
    let analysis = null;
    if (q.keyword) {
      const blogFor = (await store.getBlog()).filter(function (p) { return inRange(p, r.from, r.to) && (p.normalized_keyword || normalizeKeyword(p.keyword)) === normalizeKeyword(q.keyword); });
      const cafeFor = (await store.getCafe()).filter(function (p) { return inRange(p, r.from, r.to) && (p.normalized_keyword || normalizeKeyword(p.keyword)) === normalizeKeyword(q.keyword); });
      const a = analyze.analyzeKeyword(q.keyword, blogFor, cafeFor);
      analysis = { repeated_phrases: a.repeated_phrases, cafe_signals: a.cafe_signals, content_ideas: analyze.contentIdeas(a) };
    }
    return json(res, 200, { ok: true, type: type, period: r, posts: posts.slice(0, 100), analysis: analysis });
  } catch (e) {
    return handleError(res, e);
  }
};
