/*
 * lib/analyze.js — 블로그 확산 / 카페 반응 분석 + 콘텐츠 아이디어 (제안서 8장).
 * 규칙 기반. 나중에 AI 연동을 위한 generateAiIdeas() 자리만 둔다.
 *
 * 표현 원칙: "인기 1위/검색량 폭발" 금지 → "블로그 신규 글 증가 / 카페 반응 감지 / 콘텐츠화 가능성".
 */
var Normalize = require("./normalize");

// 카페 반응 신호 사전 (제안서 8-B)
var SIGNALS = {
  question: ["어떻게", "왜", "뭐", "어떤", "추천", "알려주세요", "궁금", "가능한가요", "되나요", "?"],
  review: ["후기", "써봤", "사용해", "다녀왔", "먹어봤", "해봤"],
  compare: ["비교", "차이", "vs", "대신", "뭐가 낫"],
  complaint: ["문제", "논란", "불편", "단점", "걱정", "위험"]
};

// 뉴스 신호(이슈 확산) 사전
var NEWS_SIGNALS = ["발표", "논란", "확정", "인상", "출시", "공개", "사고", "수사"];

// 블로그 제목 정보글 신호
var BLOG_SIGNALS = ["방법", "정리", "추천", "비교", "후기", "총정리", "가이드"];

// 제목 토큰 불용어(흔한 조사/일반어) — 반복표현 추출 시 제외
var STOPWORDS = { "그리고": 1, "관련": 1, "방법": 1, "정리": 1, "오늘": 1, "이거": 1, "있는": 1, "하는": 1, "위한": 1, "추천": 1 };

function countSignals(text, words) {
  var c = 0;
  var t = String(text || "");
  for (var i = 0; i < words.length; i++) {
    if (t.indexOf(words[i]) !== -1) c++;
  }
  return c;
}

// 제목들에서 반복되는 표현(토큰) 추출
function repeatedPhrases(titles, topN) {
  var freq = {};
  titles.forEach(function (t) {
    var toks = Normalize.stripHtml(t).split(/\s+/);
    toks.forEach(function (tok) {
      var w = tok.replace(/[^\p{L}\p{N}]/gu, "");
      if (w.length < 2) return;
      if (STOPWORDS[w]) return;
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  return Object.keys(freq)
    .filter(function (w) { return freq[w] >= 2; })
    .sort(function (a, b) { return freq[b] - freq[a]; })
    .slice(0, topN || 8)
    .map(function (w) { return { phrase: w, count: freq[w] }; });
}

// postdate(YYYYMMDD)가 최근 N일 이내인지
function isRecentPostdate(postdate, days) {
  if (!postdate || postdate.length < 8) return false;
  var y = postdate.slice(0, 4), m = postdate.slice(4, 6), d = postdate.slice(6, 8);
  var t = new Date(y + "-" + m + "-" + d + "T00:00:00Z").getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= (days || 2) * 86400000;
}

// 한 키워드의 블로그/카페 분석
function analyzeKeyword(keyword, blogPosts, cafePosts) {
  blogPosts = blogPosts || [];
  cafePosts = cafePosts || [];

  // 블로그 확산 점수 = 신규 글 수 + 제목 반복 패턴 점수 + 최근 작성일 가중치
  var blogTitles = blogPosts.map(function (p) { return p.title; });
  var phrases = repeatedPhrases(blogTitles, 8);
  var recentBlog = blogPosts.filter(function (p) { return isRecentPostdate(p.postdate, 2); }).length;
  var blogSpread = blogPosts.length + phrases.length + recentBlog;

  // 카페 반응 점수 = 신규 글 수 + 질문형 + 후기/비교/불만
  var sig = { question: 0, review: 0, compare: 0, complaint: 0 };
  cafePosts.forEach(function (p) {
    var text = (p.title || "") + " " + (p.description || "");
    sig.question += countSignals(text, SIGNALS.question) > 0 ? 1 : 0;
    sig.review += countSignals(text, SIGNALS.review) > 0 ? 1 : 0;
    sig.compare += countSignals(text, SIGNALS.compare) > 0 ? 1 : 0;
    sig.complaint += countSignals(text, SIGNALS.complaint) > 0 ? 1 : 0;
  });
  var cafeReaction = cafePosts.length + sig.question + sig.review + sig.compare + sig.complaint;

  return {
    keyword: keyword,
    blog_new_count: blogPosts.length,
    cafe_new_count: cafePosts.length,
    blog_spread_score: blogSpread,
    cafe_reaction_score: cafeReaction,
    blog_recent_count: recentBlog,
    repeated_phrases: phrases,
    cafe_signals: sig,
    blog_sample_titles: blogTitles.slice(0, 5),
    cafe_sample_titles: cafePosts.map(function (p) { return p.title; }).slice(0, 5)
  };
}

// 콘텐츠 아이디어(규칙 기반): 블로그 반복표현 + 카페 질문/비교/불만 기반
function contentIdeas(analysis) {
  var ideas = [];
  var k = analysis.keyword;
  var ph = analysis.repeated_phrases || [];
  var sig = analysis.cafe_signals || {};

  if (ph.length >= 2) ideas.push("‘" + k + "’ — 블로그에서 자주 쓰는 ‘" + ph[0].phrase + "/" + ph[1].phrase + "’ 관점 정리글");
  if (sig.question > 0) ideas.push("‘" + k + "’ 자주 묻는 질문 모음 (카페 질문 기반 FAQ)");
  if (sig.compare > 0) ideas.push("‘" + k + "’ 비교/대안 정리 (무엇이 더 나은지)");
  if (sig.review > 0) ideas.push("‘" + k + "’ 실사용 후기 모아보기 / 장단점 정리");
  if (sig.complaint > 0) ideas.push("‘" + k + "’ 단점·주의할 점 체크리스트");
  if (ideas.length === 0) ideas.push("‘" + k + "’ 기본 개념과 시작 방법 (입문 가이드)");
  return ideas.slice(0, 5);
}

function anySignal(text, words) { var t = String(text || ""); for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) !== -1) return true; return false; }

// 뉴스 제목/요약의 이슈 신호 카운트
function newsSignalCount(newsPosts) {
  var c = 0;
  (newsPosts || []).forEach(function (p) {
    if (anySignal((p.title || "") + " " + (p.description || ""), NEWS_SIGNALS)) c++;
  });
  return c;
}

// 확산 상태 분류 (제안서 3-C)
//  뉴스 주도 / 블로그 확산 / 커뮤니티 반응 / 콘텐츠화 가능 / 관찰 필요
function classifySpread(input) {
  var blog = input.blogNew || 0, cafe = input.cafeNew || 0, news = input.newsNew || 0;
  var cafeSig = input.cafeSignals || {};
  var total = blog + cafe + news;
  if (total < 3) return "관찰 필요";

  var max = Math.max(blog, cafe, news);
  // 뉴스 주도: 뉴스가 최다이고 블로그/카페보다 뚜렷이 큼
  if (news === max && news >= blog + cafe) return "뉴스 주도";
  // 콘텐츠화 가능: 블로그·카페 모두 일정 수 이상(정보글 + 실제 질문 공존)
  if (blog >= 3 && cafe >= 3) return "콘텐츠화 가능";
  // 커뮤니티 반응: 카페 최다 + 질문/후기/비교/불만 신호
  if (cafe === max && ((cafeSig.question || 0) + (cafeSig.review || 0) + (cafeSig.compare || 0) + (cafeSig.complaint || 0)) > 0) return "커뮤니티 반응";
  // 블로그 확산: 블로그 최다
  if (blog === max) return "블로그 확산";
  if (cafe === max) return "커뮤니티 반응";
  if (news === max) return "뉴스 주도";
  return "관찰 필요";
}

function spreadScore(input) {
  return (input.blogNew || 0) + (input.cafeNew || 0) + (input.newsNew || 0);
}

// 실시간 콘텐츠 아이디어: 블로그(정보글)/카페(Q&A)/뉴스(이슈해설) 신호 기반
function realtimeIdeas(keyword, blogPosts, cafePosts, newsPosts) {
  var k = keyword;
  var blog = [], reels = [], cards = [];
  var blogInfo = (blogPosts || []).some(function (p) { return anySignal(p.title, BLOG_SIGNALS); });
  var cafeAnalysis = analyzeKeyword(keyword, blogPosts, cafePosts);
  var sig = cafeAnalysis.cafe_signals;
  var newsIssue = newsSignalCount(newsPosts) > 0;

  if (blogInfo) blog.push("‘" + k + "’ 정보/정리글: 핵심 포인트와 방법 정리");
  if (sig.compare > 0) blog.push("‘" + k + "’ 비교글: 대안별 장단점 비교");
  if (sig.question > 0) cards.push("‘" + k + "’ 자주 묻는 질문 카드뉴스 (카페 질문 기반)");
  if (sig.review > 0) blog.push("‘" + k + "’ 실사용 후기 모음");
  if (sig.complaint > 0) cards.push("‘" + k + "’ 단점·주의점 체크 카드뉴스");
  if (newsIssue) blog.push("‘" + k + "’ 이슈 해설: 무슨 일이고 왜 중요한지");
  reels.push("‘" + k + "’ 1분 요약 쇼츠/릴스");
  if (sig.question > 0) reels.push("‘" + k + "’ 질문 TOP3 빠른 답 릴스");

  var flat = blog.concat(reels.map(function (s) { return "[릴스] " + s; })).concat(cards.map(function (s) { return "[카드] " + s; }));
  if (flat.length === 0) flat.push("‘" + k + "’ 입문 가이드 콘텐츠");
  return { blog: blog, reels: reels, cards: cards, flat: flat.slice(0, 6) };
}

// AI 아이디어 생성 자리(미연동). 나중에 Claude/OpenAI 연결.
function generateAiIdeas(context) { return null; }

module.exports = {
  analyzeKeyword: analyzeKeyword,
  contentIdeas: contentIdeas,
  repeatedPhrases: repeatedPhrases,
  newsSignalCount: newsSignalCount,
  classifySpread: classifySpread,
  spreadScore: spreadScore,
  realtimeIdeas: realtimeIdeas,
  generateAiIdeas: generateAiIdeas,
  SIGNALS: SIGNALS,
  NEWS_SIGNALS: NEWS_SIGNALS
};
