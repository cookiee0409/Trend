/*
 * lib/mock.js — 외부 수집 실패 시 fallback 더미 데이터 (서버용 CJS)
 */
function googleTrends() {
  const base = [
    { keyword: "월드컵 예선", traffic: "20만+", related: ["대표팀", "중계"] },
    { keyword: "전기차 보조금", traffic: "10만+", related: ["보조금 신청", "전기차"] },
    { keyword: "장마 전망", traffic: "5만+", related: ["기상청", "주말 날씨"] },
    { keyword: "챗GPT", traffic: "5만+", related: ["AI", "프롬프트"] },
    { keyword: "환율", traffic: "2만+", related: ["원달러", "금리"] },
    { keyword: "공모주 일정", traffic: "2만+", related: ["청약", "상장"] },
    { keyword: "여름휴가 추천", traffic: "1만+", related: ["국내여행", "해외여행"] },
    { keyword: "비트코인", traffic: "1만+", related: ["코인", "시세"] }
  ];
  return base.map(function (b, i) {
    return { keyword: b.keyword, rank: i + 1, metric_text: b.traffic, related_queries: b.related,
      source_url: "https://trends.google.com/trending?geo=KR (mock)" };
  });
}

function trends24(region) {
  const words = ["#월드컵예선", "대표팀", "장마", "전기요금", "챗GPT", "주말드라마",
    "콘서트티켓", "환율", "비트코인", "여름휴가", "다이어트", "공모주", "AI영상", "넷플릭스신작", "프로야구"];
  return words.map(function (w, i) {
    return { keyword: w, rank: i + 1, trend_time_label: "방금 (mock)", region: region || "korea",
      source_url: "https://trends24.in/" + (region || "korea") + "/ (mock)" };
  });
}

function naverDatalab(keywordGroups, days) {
  days = days || 14;
  const today = new Date();
  const results = [];
  (keywordGroups || []).forEach(function (g) {
    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().slice(0, 10);
      const seed = (g.groupName.length * 7 + (days - d) * 13) % 60;
      let ratio = 30 + seed + Math.round(Math.sin((days - d) / 2) * 10);
      if (ratio < 0) ratio = 0;
      if (ratio > 100) ratio = 100;
      results.push({ group_name: g.groupName, keyword_list: g.keywords, date: dateStr, ratio: ratio, time_unit: "date" });
    }
  });
  return results;
}

function ymd(daysAgo) {
  var d = new Date();
  d.setDate(d.getDate() - (daysAgo || 0));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// 네이버 블로그 검색 mock (키워드별 가짜 글)
function naverBlog(keyword, n) {
  n = n || 5;
  var templates = [
    { t: "{k} 초보자용 사용법 정리", d: "{k} 처음 시작할 때 알아두면 좋은 점을 정리했습니다." },
    { t: "무료로 {k} 해보기 (후기)", d: "직접 {k} 를 써보고 느낀 장단점 후기입니다." },
    { t: "{k} 방법 한눈에 보기", d: "{k} 하는 방법을 단계별로 설명합니다." },
    { t: "{k} 추천 TOP 5", d: "요즘 인기있는 {k} 관련 추천 목록." },
    { t: "{k} 할 때 자주 막히는 부분", d: "{k} 진행하며 헷갈렸던 부분을 모았습니다." }
  ];
  var out = [];
  for (var i = 0; i < n; i++) {
    var tp = templates[i % templates.length];
    out.push({
      title: tp.t.replace(/\{k\}/g, keyword),
      description: tp.d.replace(/\{k\}/g, keyword),
      link: "https://blog.naver.com/mock/" + encodeURIComponent(keyword) + "/" + i,
      bloggername: "블로거" + (i + 1),
      bloggerlink: "https://blog.naver.com/mock" + (i + 1),
      postdate: ymd(i % 3)
    });
  }
  return out;
}

// 네이버 카페글 검색 mock
function naverCafe(keyword, n) {
  n = n || 5;
  var templates = [
    { t: "{k} 어떤 게 좋은지 추천 좀요", d: "{k} 고민중인데 어떤 걸 골라야 할지 궁금합니다." },
    { t: "{k} 써본 후기 공유합니다", d: "{k} 직접 사용해본 후기입니다. 참고하세요." },
    { t: "{k} vs 다른거 비교 질문", d: "{k} 와 다른 것 중에 뭐가 더 나은가요? 차이가 궁금." },
    { t: "{k} 단점 없나요? 걱정되네요", d: "{k} 사용 전에 문제나 단점이 있는지 알려주세요." },
    { t: "{k} 가능한가요?", d: "{k} 이거 되나요? 어떻게 하는지 알려주세요." }
  ];
  var out = [];
  for (var i = 0; i < n; i++) {
    var tp = templates[i % templates.length];
    out.push({
      title: tp.t.replace(/\{k\}/g, keyword),
      description: tp.d.replace(/\{k\}/g, keyword),
      link: "https://cafe.naver.com/mock/" + encodeURIComponent(keyword) + "/" + i,
      cafename: "카페" + (i + 1),
      cafeurl: "https://cafe.naver.com/mock" + (i + 1)
    });
  }
  return out;
}

module.exports = { googleTrends, trends24, naverDatalab, naverBlog, naverCafe };
