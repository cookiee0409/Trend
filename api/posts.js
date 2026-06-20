/*
 * GET /api/posts?type=blog&keyword=...&from=&to=   블로그 글 목록(키워드/기간 필터)
 * GET /api/posts?type=cafe&keyword=...             카페글 목록
 * GET /api/posts?summary=1&from=&to=               키워드별 요약(구글/블로그/카페 수 + 확산/반응 점수)
 *
 * 대시보드 '블로그·카페' 화면(제안서 10장 화면1·2)을 위한 엔드포인트.
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

    // 키워드 상세: 블로그 또는 카페 목록
    const type = q.type === "cafe" ? "cafe" : "blog";
    const all = type === "cafe" ? await store.getCafe() : await store.getBlog();
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
