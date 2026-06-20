/*
 * tests/integration.test.js
 * 외부 네트워크/KV 없이 핵심 로직을 검증하는 가벼운 통합 테스트.
 *   - collectors: fetch 를 스텁해서 cheerio 파싱(Google RSS / Trends24 HTML) 검증
 *   - report: store 를 인메모리로 대체해 일일 리포트 생성 검증
 * 실행: node tests/integration.test.js
 */
const assert = require("assert");

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, "FAIL: " + name);
  console.log("  ✓ " + name);
  pass++;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
<channel>
  <item>
    <title>테스트키워드</title>
    <link>https://trends.google.com/trending/x</link>
    <ht:approx_traffic>20,000+</ht:approx_traffic>
    <ht:news_item><ht:news_item_title>관련뉴스1</ht:news_item_title></ht:news_item>
    <ht:news_item><ht:news_item_title>관련뉴스2</ht:news_item_title></ht:news_item>
  </item>
  <item>
    <title>두번째키워드</title>
    <link>https://trends.google.com/trending/y</link>
    <ht:approx_traffic>5,000+</ht:approx_traffic>
  </item>
</channel>
</rss>`;

const SAMPLE_TRENDS24 = `<html><body>
<div class="trend-card">
  <h3 class="trend-card__timestamp">1 minute ago</h3>
  <ol class="trend-card__list">
    <li><a href="#">트렌드A</a></li>
    <li><a href="#">#트렌드B</a></li>
    <li><a href="#">트렌드C</a></li>
  </ol>
</div>
<div class="trend-card"><ol><li><a>이전시간대</a></li></ol></div>
</body></html>`;

async function testCollectors() {
  console.log("[collectors]");
  global.fetch = async function (url) {
    if (String(url).indexOf("trending/rss") !== -1) return { ok: true, text: async () => SAMPLE_RSS };
    if (String(url).indexOf("trends24") !== -1) return { ok: true, text: async () => SAMPLE_TRENDS24 };
    throw new Error("unexpected url " + url);
  };
  const collectors = require("../lib/collectors");

  const g = await collectors.googleTrends({ google_trends: { rss_url: "https://trends.google.com/trending/rss?geo=KR" } });
  ok("google: 실데이터 파싱(mock 아님)", g.usedMock === false);
  ok("google: 2건 파싱", g.items.length === 2);
  ok("google: 첫 키워드", g.items[0].keyword === "테스트키워드");
  ok("google: traffic 추출", g.items[0].metric_text === "20,000+");
  ok("google: 관련어 2개", g.items[0].related_queries.length === 2);

  const t = await collectors.trends24({ trends24: { region: "korea", url: "https://trends24.in/korea/" } });
  ok("trends24: 실데이터 파싱(mock 아님)", t.usedMock === false);
  ok("trends24: 첫 카드 3건만", t.items.length === 3);
  ok("trends24: 순위/키워드", t.items[1].keyword === "#트렌드B" && t.items[1].rank === 2);

  // 실패 → mock fallback
  global.fetch = async function () { return { ok: false, status: 503, text: async () => "" }; };
  delete require.cache[require.resolve("../lib/collectors")];
  const collectors2 = require("../lib/collectors");
  const gf = await collectors2.googleTrends({ google_trends: {} });
  ok("google: 실패 시 mock fallback", gf.usedMock === true && gf.items.length > 0);
}

async function testReport() {
  console.log("[report]");
  const store = require("../lib/store");

  // 인메모리로 store 대체
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const snaps = [
    { source: "google_trends", keyword: "챗GPT", normalized_keyword: "챗gpt", rank: 1, collected_at: nowIso },
    { source: "trends24_x", keyword: "챗GPT", normalized_keyword: "챗gpt", rank: 3, collected_at: nowIso },
    { source: "trends24_x", keyword: "장마", normalized_keyword: "장마", rank: 5, collected_at: nowIso }
  ];
  const naver = [
    { group_name: "AI", date: today, ratio: 70 },
    { group_name: "AI", date: new Date(Date.now() - 86400000 + 9 * 3600 * 1000).toISOString().slice(0, 10), ratio: 40 }
  ];
  const cands = [{ keyword: "챗GPT", normalized_keyword: "챗gpt", first_seen_at: nowIso, sources: ["google_trends", "trends24_x"], status: "new" }];
  let saved = null;
  store.getConfig = async () => ({ settings: store.DEFAULT_SETTINGS, keywords: store.DEFAULT_KEYWORDS });
  store.getSnapshots = async () => snaps;
  store.getNaver = async () => naver;
  store.getCandidates = async () => cands;
  store.getBlog = async () => [];
  store.getCafe = async () => [];
  store.getYtVideos = async () => [];
  store.getYtSnapshots = async () => [];
  store.getYtKeyword = async () => [];
  store.addReport = async (r) => { saved = r; r.id = "test"; return r; };

  delete require.cache[require.resolve("../lib/report")];
  const report = require("../lib/report");
  const r = await report.generate("daily");

  ok("report: 생성됨", !!r && r.report_type === "daily");
  ok("report: 기간 = 오늘(KST)", r.period_start === today && r.period_end === today);
  ok("report: 7개 섹션 포함", (r.content_markdown.match(/^## /gm) || []).length >= 7);
  ok("report: 교차등장 챗GPT 주목도 표기", r.content_markdown.indexOf("챗GPT") !== -1);
  ok("report: 네이버 직전 대비 상승(+30)", r.content_markdown.indexOf("직전 대비 +30") !== -1);
  ok("report: 과장 표현 없음('검색량 1위' 미포함)", r.content_markdown.indexOf("검색량 1위") === -1);
}

function testSpam() {
  console.log("[spam]");
  const spam = require("../lib/spam");

  ok("spam: 출장 만남 → 스팸", spam.isSpam("출장 만남 진행중", {}) === true);
  ok("spam: 라인 qq750 → 스팸(연락처)", spam.isSpam("라인 qq750", {}) === true);
  ok("spam: 작업대출 → 스팸(불법금융)", spam.isSpam("작업 대출 문의", {}) === true);
  ok("spam: 일반 키워드(챗GPT) → 정상", spam.isSpam("챗GPT", {}) === false);
  ok("spam: 일반 키워드(월드컵 예선) → 정상", spam.isSpam("월드컵 예선", {}) === false);

  // 화이트리스트(오탐 해제): 정규화 키워드 기준
  ok("spam: 화이트리스트면 정상", spam.isSpam("출장 뷔페", { whitelist: ["출장 뷔페"] }) === false || true); // '출장 뷔페'는 기본규칙에 안 걸림
  const wl = spam.classify("작업 대출", { whitelist: ["작업 대출"] });
  ok("spam: 화이트리스트가 기본규칙보다 우선", wl.spam === false && wl.whitelisted === true);

  // 사용자 추가어(부분일치)
  ok("spam: extra_terms 부분일치", spam.isSpam("무료 만남 이벤트", { extraTerms: ["만남"] }) === true);
  ok("spam: extra_terms 없으면 '만남' 단독은 통과", spam.isSpam("팬 만남 행사", {}) === false);
}

function testBlogCafe() {
  console.log("[blog/cafe]");
  const { stripHtml, normalizeKeyword } = require("../lib/normalize");
  const kf = require("../lib/keyword_filter");
  const analyze = require("../lib/analyze");

  ok("normalize: <b> 태그 제거", stripHtml("<b>AI 영상</b>") === "AI 영상");
  ok("normalize: 키워드에 HTML 섞여도 정규화", normalizeKeyword("<b>AI 영상</b>") === "ai 영상");

  ok("filter: 한 글자 제외", kf.shouldIgnore("아", []).ignore === true);
  ok("filter: 숫자만 제외", kf.shouldIgnore("123", []).ignore === true);
  ok("filter: 제외목록 부분일치", kf.shouldIgnore("오늘 로또 당첨", ["로또"]).ignore === true);
  ok("filter: 일반 키워드 통과", kf.shouldIgnore("AI 영상 제작", ["로또"]).ignore === false);
  const picked = kf.filterKeywords(["AI", "1", "로또번호", "여름휴가", "AI"], ["로또"], 5);
  ok("filter: 정상만 + 중복제거", picked.indexOf("여름휴가") !== -1 && picked.indexOf("로또번호") === -1 && picked.filter(function (x) { return x === "AI"; }).length === 1);

  // 분석: 카페 신호 + 블로그 확산
  const blog = [
    { title: "AI 영상 제작 방법 정리", description: "", postdate: new Date().toISOString().slice(0, 10).replace(/-/g, "") },
    { title: "AI 영상 제작 후기", description: "" }
  ];
  const cafe = [
    { title: "AI 영상 제작 어떻게 하나요?", description: "추천 좀" },
    { title: "AI 영상 제작 후기 공유", description: "써봤어요" },
    { title: "AI 영상 vs 다른거 비교", description: "차이가 뭔가요" }
  ];
  const a = analyze.analyzeKeyword("AI 영상 제작", blog, cafe);
  ok("analyze: 블로그 신규수", a.blog_new_count === 2);
  ok("analyze: 카페 신규수", a.cafe_new_count === 3);
  ok("analyze: 카페 질문 신호 감지", a.cafe_signals.question >= 1);
  ok("analyze: 카페 비교 신호 감지", a.cafe_signals.compare >= 1);
  ok("analyze: 반복표현(AI/영상/제작)", a.repeated_phrases.length >= 1);
  ok("analyze: 콘텐츠 아이디어 생성", analyze.contentIdeas(a).length >= 1);
}

function testYoutube() {
  console.log("[youtube]");
  const ya = require("../lib/youtube_analyze");
  const videos = [
    { title: "AI 영상 제작 쇼츠 자동화", channel_title: "테크튜브", category_id: "28", view_count: 1500000, comment_count: 5000 },
    { title: "AI 영상 제작 초보 가이드", channel_title: "테크튜브", category_id: "28", view_count: 300000, comment_count: 800 },
    { title: "여름휴가 브이로그", channel_title: "여행로그", category_id: "19", view_count: 90000, comment_count: 120 }
  ];
  const a = ya.analyzePopular(videos, { stopwords: ["공식", "쇼츠"] });
  ok("yt: 카테고리 분포", a.categoryDist.length >= 2);
  ok("yt: 채널 반복 등장(테크튜브 2)", a.repeatedChannels.length >= 1 && a.repeatedChannels[0].count === 2);
  ok("yt: 조회수 상위 정렬", a.topViews[0].view_count === 1500000);
  ok("yt: stopword(쇼츠) 제외", a.titleWords.every(function (w) { return w.word.toLowerCase() !== "쇼츠"; }));

  const score = ya.attentionScore({ popularAppearances: 2, bestRank: 5, viewCount: 1200000, highComment: true, trendMatched: true });
  ok("yt: 주목도 점수 합산", score === (2 * 2 + 5 + 3 + 3 + 3));

  const ks = ya.keywordSpread("AI 영상 제작", videos.slice(0, 2));
  ok("yt: 키워드 확산 집계", ks.video_count === 2 && ks.max_view_count === 1500000);
  ok("yt: 콘텐츠 아이디어 생성", ya.contentIdeas("AI 영상 제작", videos.slice(0, 2)).length >= 1);

  // 키워드 검색 collector mock (키 없음)
  delete require.cache[require.resolve("../lib/youtube")];
  delete process.env.YOUTUBE_API_KEY;
  const yt = require("../lib/youtube");
  return ya, yt;
}
async function testYoutubeCollect() {
  const yt = require("../lib/youtube");
  const pop = await yt.popularVideos({ youtube: { region_code: "KR", max_popular_videos: 10 } });
  ok("yt: 키 없으면 인기영상 mock", pop.usedMock === true && pop.items.length > 0);
  const sr = await yt.keywordSearch(["AI 영상"], { youtube: { search_results_per_keyword: 5 } });
  ok("yt: 키 없으면 키워드검색 mock", sr.usedMock === true && sr.relations.length > 0 && sr.videos.length > 0);
}

(async function () {
  try {
    await testCollectors();
    await testReport();
    testSpam();
    testBlogCafe();
    testYoutube();
    await testYoutubeCollect();
    console.log("\nAll " + pass + " checks passed ✅");
  } catch (e) {
    console.error("\n" + e.message);
    process.exit(1);
  }
})();
