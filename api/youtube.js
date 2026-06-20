/*
 * GET /api/youtube?from=&to=
 *   대시보드용 YouTube 데이터: 인기 영상(최신 스냅샷), 조회수/댓글 상위,
 *   반복 채널, 카테고리 분포, Google Trends 키워드 연결 영상.
 */
const store = require("../lib/store");
const report = require("../lib/report");
const ytAnalyze = require("../lib/youtube_analyze");
const { json, handleError } = require("../lib/http");

function inRange(iso, from, to) { const d = report.kstDateStr(iso); return d >= from && d <= to; }

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    const q = req.query || {};
    const to = q.to || report.todayKst();
    const from = q.from || report.kstDateStr(Date.now() - 7 * 86400000);

    const cfg = await store.getConfig();
    const stopwords = (cfg.settings.youtube && cfg.settings.youtube.stopwords) || [];

    const videos = await store.getYtVideos();
    const vmap = {};
    videos.forEach(function (v) { vmap[v.video_id] = v; });

    const snaps = (await store.getYtSnapshots()).filter(function (s) { return inRange(s.collected_at, from, to); });
    // 가장 최근 수집 회차의 인기 영상만 사용(옛 mock과 실데이터 혼재 방지, 순위 중복 방지)
    const popAll = snaps.filter(function (s) { return s.source_type === "popular"; });
    let maxT = "";
    popAll.forEach(function (s) { if (s.collected_at > maxT) maxT = s.collected_at; });
    const popRun = popAll.filter(function (s) { return s.collected_at === maxT; });
    const popVideos = popRun.map(function (s) {
      const vid = s.video_id; const v = vmap[vid] || {};
      return {
        video_id: vid, title: v.title || "", channel_title: v.channel_title || "", channel_id: v.channel_id || "",
        category_id: v.category_id || "", category: ytAnalyze.categoryName(v.category_id),
        published_at: v.published_at || "", thumbnail_url: v.thumbnail_url || "", video_url: v.video_url || "",
        view_count: s.view_count, comment_count: s.comment_count, like_count: s.like_count,
        rank: s.rank, collected_at: s.collected_at
      };
    }).sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });

    const analysis = ytAnalyze.analyzePopular(popVideos, { stopwords: stopwords });

    // 키워드 연결 영상 (가장 최근 수집 회차만)
    const kwAll = (await store.getYtKeyword()).filter(function (r) { return inRange(r.collected_at, from, to); });
    let kwMaxT = "";
    kwAll.forEach(function (r) { if (r.collected_at > kwMaxT) kwMaxT = r.collected_at; });
    const kwRows = kwAll.filter(function (r) { return r.collected_at === kwMaxT; });
    const kwMap = {};
    kwRows.forEach(function (r) {
      if (!kwMap[r.normalized_keyword]) kwMap[r.normalized_keyword] = { keyword: r.keyword, videos: {} };
      kwMap[r.normalized_keyword].videos[r.video_id] = true;
    });
    const keywordLinks = Object.keys(kwMap).map(function (nk) {
      return { keyword: kwMap[nk].keyword, video_count: Object.keys(kwMap[nk].videos).length };
    }).sort(function (a, b) { return b.video_count - a.video_count; });

    return json(res, 200, {
      ok: true,
      period: { from: from, to: to },
      popular: popVideos.slice(0, 50),
      top_views: analysis.topViews,
      top_comments: analysis.topComments,
      repeated_channels: analysis.repeatedChannels,
      category_dist: analysis.categoryDist,
      title_words: analysis.titleWords,
      keyword_links: keywordLinks
    });
  } catch (e) {
    return handleError(res, e);
  }
};
