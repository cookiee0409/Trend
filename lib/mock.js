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

module.exports = { googleTrends, trends24, naverDatalab };
