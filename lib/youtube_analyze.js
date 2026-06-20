/*
 * lib/youtube_analyze.js — YouTube 인기 영상 흐름 / 키워드 확산 분석 + 콘텐츠 아이디어.
 * 규칙 기반. 점수는 "정확한 순위"가 아니라 "내부 YouTube 주목도".
 * generateAiYoutubeIdeas() 자리만 둔다.
 */
var Normalize = require("./normalize");

// 흔한 YouTube 카테고리 ID → 한글 이름(표시용)
var CATEGORY = {
  "1": "영화/애니", "2": "자동차", "10": "음악", "15": "동물", "17": "스포츠",
  "19": "여행", "20": "게임", "22": "인물/블로그", "23": "코미디", "24": "엔터테인먼트",
  "25": "뉴스/정치", "26": "노하우/스타일", "27": "교육", "28": "과학기술", "29": "비영리"
};

function categoryName(id) { return CATEGORY[String(id)] || ("기타(" + id + ")"); }

function repeatedTitleWords(titles, stopwords, topN) {
  var stop = {};
  (stopwords || []).forEach(function (w) { stop[Normalize.normalizeKeyword(w)] = 1; });
  var freq = {};
  titles.forEach(function (t) {
    Normalize.stripHtml(t).split(/\s+/).forEach(function (tok) {
      var w = tok.replace(/[^\p{L}\p{N}]/gu, "");
      var nw = w.toLowerCase();
      if (w.length < 2) return;
      if (stop[nw]) return;
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  return Object.keys(freq).filter(function (w) { return freq[w] >= 2; })
    .sort(function (a, b) { return freq[b] - freq[a]; })
    .slice(0, topN || 8)
    .map(function (w) { return { word: w, count: freq[w] }; });
}

// 인기 영상 목록 분석
function analyzePopular(videos, opts) {
  opts = opts || {};
  videos = videos || [];

  // 카테고리 분포
  var cat = {};
  videos.forEach(function (v) { var c = categoryName(v.category_id); cat[c] = (cat[c] || 0) + 1; });
  var categoryDist = Object.keys(cat).map(function (c) { return { category: c, count: cat[c] }; })
    .sort(function (a, b) { return b.count - a.count; });

  // 채널 반복 등장
  var ch = {};
  videos.forEach(function (v) { var c = v.channel_title || v.channel_id; if (c) ch[c] = (ch[c] || 0) + 1; });
  var repeatedChannels = Object.keys(ch).filter(function (c) { return ch[c] >= 2; })
    .map(function (c) { return { channel: c, count: ch[c] }; })
    .sort(function (a, b) { return b.count - a.count; });

  var byViews = videos.slice().sort(function (a, b) { return (b.view_count || 0) - (a.view_count || 0); });
  var byComments = videos.slice().sort(function (a, b) { return (b.comment_count || 0) - (a.comment_count || 0); });
  var titleWords = repeatedTitleWords(videos.map(function (v) { return v.title; }), opts.stopwords, 10);

  return {
    count: videos.length,
    categoryDist: categoryDist,
    repeatedChannels: repeatedChannels,
    topViews: byViews.slice(0, 5),
    topComments: byComments.slice(0, 5),
    titleWords: titleWords
  };
}

// 내부 YouTube 주목도 점수
function attentionScore(opts) {
  // opts: { popularAppearances, bestRank, viewCount, commentCount, highComment, trendMatched, repeated }
  opts = opts || {};
  var s = 0;
  s += (opts.popularAppearances || 0) * 2;
  if (opts.bestRank && opts.bestRank <= 10) s += 5;
  else if (opts.bestRank && opts.bestRank <= 30) s += 2;
  if ((opts.viewCount || 0) >= 1000000) s += 3;
  else if ((opts.viewCount || 0) >= 100000) s += 1;
  if (opts.highComment) s += 3;
  if (opts.trendMatched) s += 3;
  if (opts.repeated) s += 2;
  return s;
}

// 키워드별 YouTube 확산(검색 결과 영상들 기준)
function keywordSpread(keyword, videos) {
  videos = videos || [];
  var views = videos.map(function (v) { return v.view_count || 0; });
  var total = views.reduce(function (a, b) { return a + b; }, 0);
  return {
    keyword: keyword,
    video_count: videos.length,
    total_view_count: total,
    avg_view_count: videos.length ? Math.round(total / videos.length) : 0,
    max_view_count: views.length ? Math.max.apply(null, views) : 0,
    total_comment_count: videos.reduce(function (a, v) { return a + (v.comment_count || 0); }, 0),
    title_words: repeatedTitleWords(videos.map(function (v) { return v.title; }), [], 6),
    sample_titles: videos.slice(0, 5).map(function (v) { return v.title; }),
    sample_channels: videos.slice(0, 5).map(function (v) { return v.channel_title; })
  };
}

// 콘텐츠 아이디어(규칙 기반)
function contentIdeas(keyword, videos) {
  var ks = keywordSpread(keyword, videos);
  var ideas = [];
  var tw = ks.title_words.map(function (w) { return w.word; });
  if (tw.length >= 2) ideas.push("‘" + keyword + "’ — 영상 제목에 자주 나오는 ‘" + tw[0] + "/" + tw[1] + "’ 관점 정리(쇼츠/블로그)");
  if (ks.video_count >= 3) ideas.push("‘" + keyword + "’ 인기 영상 " + ks.video_count + "개 핵심만 요약 비교");
  if (ks.max_view_count >= 100000) ideas.push("‘" + keyword + "’ 조회수 높은 영상이 다루는 포인트 분석");
  ideas.push("‘" + keyword + "’ 입문자용 가이드 영상 기획");
  return ideas.slice(0, 4);
}

function generateAiYoutubeIdeas(context) { return null; }

module.exports = {
  analyzePopular: analyzePopular,
  attentionScore: attentionScore,
  keywordSpread: keywordSpread,
  contentIdeas: contentIdeas,
  repeatedTitleWords: repeatedTitleWords,
  categoryName: categoryName,
  generateAiYoutubeIdeas: generateAiYoutubeIdeas
};
