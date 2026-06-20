/*
 * lib/report.js — 규칙 기반 Markdown 리포트 생성 (서버용 CJS, KST 기준).
 * AI 요약은 generateAiSummary() 자리만 분리(현재 null).
 * 표현 원칙: "검색량" 단정 금지 → "검색 관심도 / 내부 기준 주목도 / 반복 등장".
 */
const store = require("./store");
const { normalizeKeyword } = require("./normalize");
const { computeScore } = require("./scoring");
const spam = require("./spam");
const analyze = require("./analyze");
const ytAnalyze = require("./youtube_analyze");

const KST_OFFSET = 9 * 3600 * 1000;

function kstDateStr(d) { return new Date(new Date(d).getTime() + KST_OFFSET).toISOString().slice(0, 10); }
function todayKst() { return kstDateStr(Date.now()); }
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rangeFor(type) {
  const today = todayKst();
  if (type === "daily") return { start: today, end: today };
  if (type === "weekly") return { start: addDaysStr(today, -6), end: today };
  // monthly: 전월 1일 ~ 말일
  const parts = today.split("-");
  const firstThis = parts[0] + "-" + parts[1] + "-01";
  const prevEnd = addDaysStr(firstThis, -1);
  const pe = prevEnd.split("-");
  return { start: pe[0] + "-" + pe[1] + "-01", end: prevEnd };
}

function groupByKeyword(snapshots) {
  const map = {};
  snapshots.forEach(function (s) {
    const nk = s.normalized_keyword || normalizeKeyword(s.keyword);
    if (!map[nk]) map[nk] = { normalized: nk, display: s.keyword, snaps: [], sources: {} };
    map[nk].snaps.push(s);
    map[nk].sources[s.source] = true;
  });
  return map;
}

function topBySource(snapshots, source, limit) {
  const map = groupByKeyword(snapshots.filter(function (s) { return s.source === source; }));
  const arr = Object.keys(map).map(function (k) {
    const g = map[k];
    const bestRank = Math.min.apply(null, g.snaps.map(function (s) { return s.rank || 999; }));
    return { keyword: g.display, count: g.snaps.length, bestRank: bestRank };
  });
  arr.sort(function (a, b) { return a.bestRank !== b.bestRank ? a.bestRank - b.bestRank : b.count - a.count; });
  return arr.slice(0, limit || 10);
}

function crossSource(snapshots, keywordGroups, limit) {
  const naverSet = {};
  (keywordGroups || []).forEach(function (g) { g.keywords.forEach(function (kw) { naverSet[normalizeKeyword(kw)] = true; }); });
  const map = groupByKeyword(snapshots);
  const arr = Object.keys(map).map(function (k) {
    const g = map[k];
    const inNaver = !!naverSet[g.normalized];
    return { keyword: g.display, score: computeScore(g.snaps, { inNaverGroups: inNaver }),
      count: g.snaps.length, sources: Object.keys(g.sources), inNaver: inNaver };
  });
  arr.sort(function (a, b) { return b.score - a.score; });
  return arr.slice(0, limit || 15);
}

function naverRising(naverRows, limit) {
  const byGroup = {};
  naverRows.forEach(function (r) { (byGroup[r.group_name] = byGroup[r.group_name] || []).push(r); });
  const out = [];
  Object.keys(byGroup).forEach(function (g) {
    const rows = byGroup[g].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (rows.length === 0) return;
    const latest = rows[rows.length - 1].ratio;
    const prev = rows.length >= 2 ? rows[rows.length - 2].ratio : latest;
    const avg = rows.reduce(function (s, r) { return s + r.ratio; }, 0) / rows.length;
    const r1 = function (x) { return Math.round(x * 10) / 10; }; // 소수점 1자리 반올림
    out.push({ group: g, latest: r1(latest), deltaPrev: r1(latest - prev), deltaAvg: r1(latest - avg) });
  });
  out.sort(function (a, b) { return b.deltaPrev - a.deltaPrev; });
  return out.slice(0, limit || 10);
}

function contentIdeas(topKeywords, n) {
  const templates = [
    function (k) { return "‘" + k + "’ 지금 왜 뜨는지 1분 정리 (쇼츠/릴스)"; },
    function (k) { return "‘" + k + "’ 관련 핵심 포인트 3가지 (블로그)"; },
    function (k) { return "‘" + k + "’ 초보자용 입문 가이드"; },
    function (k) { return "‘" + k + "’ 관련 자주 묻는 질문 모음"; },
    function (k) { return "‘" + k + "’ 트렌드 비교 / 전망"; }
  ];
  const ideas = [];
  for (let i = 0; i < topKeywords.length && ideas.length < (n || 10); i++) ideas.push(templates[i % templates.length](topKeywords[i]));
  return ideas;
}

// AI 요약 자리 (나중에 Claude/OpenAI 연동). 현재 null.
function generateAiSummary(context) { return null; }

function line(arr, mapper) {
  if (!arr || arr.length === 0) return "- (데이터 없음)\n";
  return arr.map(mapper).join("\n") + "\n";
}

async function generate(type) {
  const range = rangeFor(type);
  const cfg = await store.getConfig();
  const keywordGroups = cfg.keywords;

  // 스팸 필터: enforce 모드면 리포트 집계에서 제외 (observe 모드면 그대로 포함)
  const sf = cfg.settings.spam_filter || { mode: "observe", extra_terms: [], whitelist: [] };
  const spamOpts = { extraTerms: sf.extra_terms || [], whitelist: sf.whitelist || [] };
  const enforceSpam = sf.mode === "enforce";
  const notSpam = function (kw) { return !enforceSpam || !spam.isSpam(kw, spamOpts); };

  const allSnaps = await store.getSnapshots();
  const snaps = allSnaps.filter(function (s) {
    const d = kstDateStr(s.collected_at);
    return d >= range.start && d <= range.end && notSpam(s.keyword);
  });
  const allNaver = await store.getNaver();
  const naverSeries = allNaver.filter(function (r) { return r.date <= range.end; });
  // 네이버 데이터는 보통 하루 지연되어 '오늘' 행이 없으므로, 헤더는 그룹 수/최신일자로 표기
  const naverGroupSet = {};
  let naverLatest = "";
  naverSeries.forEach(function (r) { naverGroupSet[r.group_name] = 1; if (r.date > naverLatest) naverLatest = r.date; });
  const naverGroupCount = Object.keys(naverGroupSet).length;
  const candidates = await store.getCandidates();

  // 블로그/카페: 기간 내 수집분을 정규화 키워드 단위로 분석
  const inRange = function (p) { const d = kstDateStr(p.collected_at); return d >= range.start && d <= range.end && notSpam(p.keyword); };
  const blogPosts = (await store.getBlog()).filter(inRange);
  const cafePosts = (await store.getCafe()).filter(inRange);
  const byKw = {};
  function bucket(p) {
    const nk = p.normalized_keyword || normalizeKeyword(p.keyword);
    if (!byKw[nk]) byKw[nk] = { keyword: p.keyword, blog: [], cafe: [] };
    return byKw[nk];
  }
  blogPosts.forEach(function (p) { bucket(p).blog.push(p); });
  cafePosts.forEach(function (p) { bucket(p).cafe.push(p); });
  const analyses = Object.keys(byKw).map(function (nk) {
    const b = byKw[nk];
    return analyze.analyzeKeyword(b.keyword, b.blog, b.cafe);
  });
  const blogRanked = analyses.filter(function (a) { return a.blog_new_count > 0; })
    .sort(function (a, b) { return b.blog_spread_score - a.blog_spread_score; });
  const cafeRanked = analyses.filter(function (a) { return a.cafe_new_count > 0; })
    .sort(function (a, b) { return b.cafe_reaction_score - a.cafe_reaction_score; });

  // YouTube: 기간 내 인기 영상 스냅샷 + 영상정보 + 키워드 관계
  const ytStopwords = (cfg.settings.youtube && cfg.settings.youtube.stopwords) || [];
  const ytVideos = await store.getYtVideos();
  const ytVideoMap = {};
  ytVideos.forEach(function (v) { ytVideoMap[v.video_id] = v; });
  const ytSnaps = (await store.getYtSnapshots()).filter(function (s) { const d = kstDateStr(s.collected_at); return d >= range.start && d <= range.end; });
  // 인기 영상: 기간 내 가장 최근 수집 회차만(옛 mock/실데이터 혼재 방지)
  const ytPopAll = ytSnaps.filter(function (s) { return s.source_type === "popular"; });
  let ytMaxT = "";
  ytPopAll.forEach(function (s) { if (s.collected_at > ytMaxT) ytMaxT = s.collected_at; });
  const popVideos = ytPopAll.filter(function (s) { return s.collected_at === ytMaxT; }).map(function (s) {
    const v = ytVideoMap[s.video_id] || {};
    return { video_id: s.video_id, title: v.title || "", channel_title: v.channel_title || "", category_id: v.category_id || "",
      video_url: v.video_url || "", view_count: s.view_count, comment_count: s.comment_count, rank: s.rank };
  });
  const ytPop = ytAnalyze.analyzePopular(popVideos, { stopwords: ytStopwords });
  // 키워드 연결: 기간 내 가장 최근 수집 회차만
  const ytKwAll = (await store.getYtKeyword()).filter(function (r) { const d = kstDateStr(r.collected_at); return d >= range.start && d <= range.end; });
  let ytKwMaxT = "";
  ytKwAll.forEach(function (r) { if (r.collected_at > ytKwMaxT) ytKwMaxT = r.collected_at; });
  const ytKwRows = ytKwAll.filter(function (r) { return r.collected_at === ytKwMaxT; });
  const ytKwMap = {};
  ytKwRows.forEach(function (r) {
    if (!ytKwMap[r.normalized_keyword]) ytKwMap[r.normalized_keyword] = { keyword: r.keyword, videos: {} };
    ytKwMap[r.normalized_keyword].videos[r.video_id] = true;
  });
  const ytKwRanked = Object.keys(ytKwMap).map(function (nk) {
    return { keyword: ytKwMap[nk].keyword, video_count: Object.keys(ytKwMap[nk].videos).length, normalized: nk };
  }).filter(function (x) { return notSpam(x.keyword); }).sort(function (a, b) { return b.video_count - a.video_count; });

  const gTop = topBySource(snaps, "google_trends", 10);
  const xTop = topBySource(snaps, "trends24_x", 10);
  const cross = crossSource(snaps, keywordGroups, 15);
  const rising = naverRising(naverSeries, 10);

  const typeLabel = { daily: "일일", weekly: "주간", monthly: "월간" }[type];
  const periodStr = range.start + " ~ " + range.end;

  let md = "";
  md += "# " + typeLabel + " 트렌드 리포트\n\n";
  md += "- 기간: " + periodStr + " (KST)\n";
  md += "- 생성 시각: " + new Date(Date.now() + KST_OFFSET).toISOString().replace("T", " ").slice(0, 16) + " KST\n";
  md += "- 수집 스냅샷 수: " + snaps.length + "건 / 네이버 데이터랩 " + naverGroupCount + "개 그룹 추이" + (naverLatest ? "(최신 " + naverLatest + ")" : "") + "\n\n";
  md += "> 본 리포트의 값은 절대 검색량이 아니라 **검색 관심도 / 내부 기준 주목도**입니다.\n\n";

  const ai = generateAiSummary({ type: type, crossSource: cross, naverRising: rising });
  if (ai) md += "## AI 요약\n\n" + ai + "\n\n";

  md += "## 1. Google Trends 급상승 검색어 (수집 기준 상위)\n";
  md += line(gTop, function (k) { return "- " + k.keyword + " (최고 순위 " + (k.bestRank === 999 ? "-" : k.bestRank) + ", 등장 " + k.count + "회)"; }) + "\n";

  md += "## 2. Trends24 X/Twitter 주요 키워드 (수집 기준 상위)\n";
  md += line(xTop, function (k) { return "- " + k.keyword + " (최고 순위 " + (k.bestRank === 999 ? "-" : k.bestRank) + ", 등장 " + k.count + "회)"; }) + "\n";

  md += "## 3. 네이버 데이터랩 검색 관심도 상승 그룹\n";
  md += line(rising, function (r) {
    return "- " + r.group + " (최근 ratio " + r.latest + ", 직전 대비 " + (r.deltaPrev >= 0 ? "+" : "") + r.deltaPrev + ", 기간평균 대비 " + (r.deltaAvg >= 0 ? "+" : "") + r.deltaAvg + ")";
  }) + "\n";

  md += "## 4. 여러 소스에서 반복 등장한 키워드 (내부 기준 주목도)\n";
  md += line(cross, function (c) { return "- " + c.keyword + " (주목도 " + c.score + ", 소스 " + c.sources.length + "개" + (c.inNaver ? ", 네이버 그룹 포함" : "") + ")"; }) + "\n";

  const newCands = candidates.filter(function (c) { return kstDateStr(c.first_seen_at) >= range.start && notSpam(c.keyword); }).slice(0, 15);
  md += "## 5. 새로 발견된 키워드 후보\n";
  md += line(newCands, function (c) { return "- " + c.keyword + " (소스: " + c.sources.join(", ") + ", 상태: " + c.status + ")"; }) + "\n";

  md += "## 6. " + (type === "daily" ? "내일도" : type === "weekly" ? "다음 주" : "다음 달") + " 추적 추천 키워드\n";
  md += line(cross.slice(0, 8), function (c) { return "- " + c.keyword; }) + "\n";

  md += "## 7. 콘텐츠 제작 아이디어 (" + (type === "daily" ? "블로그/릴스/쇼츠" : "추천 주제") + ")\n";
  md += line(contentIdeas(cross.map(function (c) { return c.keyword; }), type === "daily" ? 5 : 10), function (s) { return "- " + s; }) + "\n";

  // ----- 네이버 블로그·카페 확산/반응 -----
  md += "## 8. 네이버 블로그로 확산된 키워드 (수집 기준)\n";
  md += line(blogRanked.slice(0, 10), function (a) {
    var ph = (a.repeated_phrases || []).slice(0, 3).map(function (p) { return p.phrase; }).join(", ");
    return "- " + a.keyword + " (신규 블로그 " + a.blog_new_count + "건, 확산점수 " + a.blog_spread_score +
      (ph ? ", 반복표현: " + ph : "") + ")";
  }) + "\n";

  md += "## 9. 네이버 카페에서 반응이 나온 키워드 (수집 기준)\n";
  md += line(cafeRanked.slice(0, 10), function (a) {
    var s = a.cafe_signals || {};
    return "- " + a.keyword + " (신규 카페글 " + a.cafe_new_count + "건, 반응점수 " + a.cafe_reaction_score +
      ", 질문 " + s.question + "/후기 " + s.review + "/비교 " + s.compare + "/우려 " + s.complaint + ")";
  }) + "\n";

  md += "## 10. 블로그·카페 기반 콘텐츠 아이디어\n";
  var ideaKws = (blogRanked.concat(cafeRanked)).slice(0, type === "daily" ? 4 : 8);
  var seenIdea = {};
  var ideaLines = [];
  ideaKws.forEach(function (a) {
    if (seenIdea[a.keyword]) return; seenIdea[a.keyword] = true;
    analyze.contentIdeas(a).forEach(function (idea) { ideaLines.push(idea); });
  });
  md += line(ideaLines.slice(0, type === "daily" ? 6 : 12), function (s) { return "- " + s; }) + "\n";

  // ----- YouTube 인기 영상 흐름 -----
  md += "## 11. YouTube 인기 영상 흐름 (수집 기준)\n";
  if (popVideos.length === 0 && ytKwRanked.length === 0) {
    md += "- (YouTube 수집 데이터 없음)\n\n";
  } else {
    md += "### 많이 보인 카테고리\n";
    md += line(ytPop.categoryDist.slice(0, 5), function (c) { return "- " + c.category + " (" + c.count + "개)"; });
    md += "### 제목에서 자주 보인 표현\n";
    md += (ytPop.titleWords.length ? ytPop.titleWords.slice(0, 8).map(function (w) { return "- " + w.word + " (" + w.count + ")"; }).join("\n") + "\n" : "- (없음)\n");
    md += "### 반복 등장한 채널\n";
    md += line(ytPop.repeatedChannels.slice(0, 5), function (c) { return "- " + c.channel + " / " + c.count + "개"; });
    md += "### 조회수 상위 영상\n";
    md += line(ytPop.topViews.slice(0, 5), function (v) { return "- [" + v.title + "](" + v.video_url + ") — " + v.channel_title + " / 조회수 " + (v.view_count || 0).toLocaleString() + ""; });
    md += "### 댓글 많은 영상\n";
    md += line(ytPop.topComments.slice(0, 3), function (v) { return "- [" + v.title + "](" + v.video_url + ") — 댓글 " + (v.comment_count || 0).toLocaleString(); });
    md += "### Google Trends 키워드와 연결된 YouTube 영상\n";
    md += line(ytKwRanked.slice(0, 8), function (k) { return "- " + k.keyword + ": 관련 영상 " + k.video_count + "개 감지"; });

    // YouTube 기반 콘텐츠 아이디어 (키워드 검색 영상 기준)
    md += "### YouTube 기반 콘텐츠 아이디어\n";
    const ytIdeaLines = [];
    ytKwRanked.slice(0, type === "daily" ? 3 : 6).forEach(function (k) {
      const vids = ytKwRows.filter(function (r) { return r.normalized_keyword === k.normalized; })
        .map(function (r) { return ytVideoMap[r.video_id]; }).filter(Boolean);
      ytAnalyze.contentIdeas(k.keyword, vids).forEach(function (idea) { ytIdeaLines.push(idea); });
    });
    md += (ytIdeaLines.length ? ytIdeaLines.slice(0, type === "daily" ? 5 : 10).map(function (s) { return "- " + s; }).join("\n") + "\n" : "- (없음)\n");
    md += "\n";
  }

  md += "---\n";
  md += "_데이터 소스: Google Trends(RSS), Trends24(제3자 사이트), 네이버 데이터랩/블로그/카페 검색, YouTube Data API._\n";
  md += "_네이버 블로그·카페·YouTube 검색 결과는 전수 데이터가 아니며, 신규 글/영상 수와 조회수는 수집 시점 기준 참고 지표입니다._\n";

  const summary = typeLabel + " 리포트 — 반복 등장 상위: " + cross.slice(0, 3).map(function (c) { return c.keyword; }).join(", ");

  return await store.addReport({
    report_type: type,
    period_start: range.start,
    period_end: range.end,
    title: typeLabel + " 트렌드 리포트 (" + periodStr + ")",
    summary: summary,
    content_markdown: md,
    content_json: JSON.stringify({ type: type, snapshots: snaps.length, blog: blogPosts.length, cafe: cafePosts.length, youtube_popular: popVideos.length })
  });
}

module.exports = { generate, rangeFor, kstDateStr, todayKst, generateAiSummary };
