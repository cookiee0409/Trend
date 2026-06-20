/*
 * lib/youtube.js — YouTube Data API v3 수집기.
 *  - popularVideos: videos.list(chart=mostPopular, regionCode=KR)  (1 call, 저렴)
 *  - keywordSearch: search.list(q=keyword) 로 videoId 수집(키워드당 100 units)
 *                   → 모은 videoId 를 videos.list 로 배치 상세조회(50개씩)
 * 키 없음/오류/quota 초과 시 mock 으로 폴백, 절대 throw 하지 않는다.
 */
const mock = require("./mock");
const { stripHtml, normalizeKeyword } = require("./normalize");

const API = "https://www.googleapis.com/youtube/v3";

function key() { return process.env.YOUTUBE_API_KEY; }

async function ytFetch(path) {
  const res = await fetch(API + path + "&key=" + encodeURIComponent(key()));
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("HTTP " + res.status + " " + txt.slice(0, 140));
  }
  return await res.json();
}

// videos.list 응답 item → 표준 영상 객체
function mapVideo(it, rank) {
  const sn = it.snippet || {};
  const st = it.statistics || {};
  const cd = it.contentDetails || {};
  const thumbs = sn.thumbnails || {};
  const thumb = (thumbs.medium || thumbs.high || thumbs.default || {}).url || "";
  return {
    video_id: it.id,
    title: stripHtml(sn.title || ""),
    description: stripHtml(sn.description || "").slice(0, 500),
    channel_id: sn.channelId || "",
    channel_title: stripHtml(sn.channelTitle || ""),
    category_id: sn.categoryId || "",
    published_at: sn.publishedAt || "",
    duration: cd.duration || "",
    view_count: Number(st.viewCount || 0),
    like_count: Number(st.likeCount || 0),
    comment_count: Number(st.commentCount || 0),
    favorite_count: Number(st.favoriteCount || 0),
    thumbnail_url: thumb,
    video_url: "https://www.youtube.com/watch?v=" + it.id,
    rank: rank || null
  };
}

/* ---------- 한국 인기 영상 ---------- */
async function popularVideos(settings) {
  const yt = (settings && settings.youtube) || {};
  const region = yt.region_code || "KR";
  const max = Math.min(yt.max_popular_videos || 50, 50);
  if (!key()) {
    return { ok: true, usedMock: true, items: mock.youtubePopular(max, region), message: "YouTube: API 키 없음 → mock" };
  }
  try {
    const json = await ytFetch("/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=" + region + "&maxResults=" + max);
    const items = (json.items || []).map(function (it, i) { return mapVideo(it, i + 1); });
    if (items.length === 0) throw new Error("인기 영상 결과 없음");
    return { ok: true, usedMock: false, items: items, region: region, message: "YouTube 인기 영상 수집 성공 (" + items.length + "건)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.youtubePopular(max, region), region: region, message: "YouTube 인기 영상 실패 → mock (" + e.message + ")" };
  }
}

/* ---------- Google Trends 키워드 기반 검색 ---------- */
async function keywordSearch(keywords, settings) {
  const yt = (settings && settings.youtube) || {};
  const region = yt.region_code || "KR";
  const perKw = Math.min(yt.search_results_per_keyword || 10, 20);
  const order = yt.search_order || "relevance";

  if (!keywords || keywords.length === 0) {
    return { ok: false, usedMock: false, relations: [], videos: [], message: "YouTube 검색: 키워드 없음(생략)" };
  }
  if (!key()) {
    return mockKeyword(keywords, perKw);
  }
  try {
    const relations = []; // {keyword, normalized_keyword, video_id, search_rank, search_order}
    const idSet = {};
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const json = await ytFetch("/search?part=snippet&type=video&regionCode=" + region +
        "&order=" + order + "&maxResults=" + perKw + "&q=" + encodeURIComponent(kw));
      (json.items || []).forEach(function (it, r) {
        const vid = it.id && it.id.videoId;
        if (!vid) return;
        relations.push({ keyword: kw, normalized_keyword: normalizeKeyword(kw), video_id: vid, search_rank: r + 1, search_order: order });
        idSet[vid] = true;
      });
    }
    const ids = Object.keys(idSet);
    const videos = await fetchVideoDetails(ids);
    return { ok: true, usedMock: false, relations: relations, videos: videos, message: "YouTube 키워드 검색 성공 (" + keywords.length + "키워드, 영상 " + videos.length + ")" };
  } catch (e) {
    const m = mockKeyword(keywords, perKw);
    m.message = "YouTube 키워드 검색 실패 → mock (" + e.message + ")";
    return m;
  }
}

// videoId 배열을 50개씩 묶어 상세 조회
async function fetchVideoDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const json = await ytFetch("/videos?part=snippet,statistics,contentDetails&id=" + chunk.join(","));
    (json.items || []).forEach(function (it) { out.push(mapVideo(it, null)); });
  }
  return out;
}

function mockKeyword(keywords, perKw) {
  const relations = [];
  const videosMap = {};
  keywords.forEach(function (kw) {
    mock.youtubeSearch(kw, perKw).forEach(function (v, r) {
      relations.push({ keyword: kw, normalized_keyword: normalizeKeyword(kw), video_id: v.video_id, search_rank: r + 1, search_order: "relevance" });
      videosMap[v.video_id] = v;
    });
  });
  return { ok: true, usedMock: true, relations: relations, videos: Object.keys(videosMap).map(function (k) { return videosMap[k]; }), message: "YouTube 키워드 검색 mock" };
}

module.exports = { popularVideos, keywordSearch, mapVideo };
