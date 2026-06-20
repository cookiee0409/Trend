/*
 * lib/collectors.js — 서버 측 수집기 (CORS 없음, 실제 fetch).
 * 각 함수는 { ok, usedMock, items, message } 를 반환한다.
 * 실패 시 mock 으로 대체하여 절대 throw 하지 않는다(앱이 죽지 않도록).
 *
 * Trends24 는 제3자 사이트이므로: User-Agent 명시, 재시도 최대 1회, 타임아웃 적용.
 */
const cheerio = require("cheerio");
const mock = require("./mock");
const { stripHtml } = require("./normalize");

const UA = "Mozilla/5.0 (compatible; TrendReportBot/1.0; personal-use)";

async function fetchText(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(function () { controller.abort(); }, timeoutMs || 8000);
  try {
    const res = await fetch(url, Object.assign({ signal: controller.signal, headers: { "User-Agent": UA } }, opts || {}));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Google Trends (Trending Now RSS) ---------- */
async function googleTrends(settings) {
  const url = (settings.google_trends && settings.google_trends.rss_url) || "https://trends.google.com/trending/rss?geo=KR";
  try {
    const xml = await fetchText(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" } });
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $("item").each(function (i, item) {
      const $item = $(item);
      const keyword = $item.children("title").first().text().trim();
      const link = $item.children("link").first().text().trim();
      let traffic = "";
      const related = [];
      $item.find("*").each(function (j, ch) {
        const nm = (ch.name || "").toLowerCase();
        if (nm.endsWith("approx_traffic") && !traffic) traffic = $(ch).text().trim();
        if (nm.endsWith("news_item_title")) related.push($(ch).text().trim());
      });
      if (keyword) items.push({ keyword: keyword, rank: i + 1, metric_text: traffic, related_queries: related, source_url: link || "https://trends.google.com/trending" });
    });
    if (items.length === 0) throw new Error("RSS item 이 비어 있음 (구조 변경 가능성)");
    return { ok: true, usedMock: false, items: items, message: "Google Trends RSS 수집 성공 (" + items.length + "건)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.googleTrends(), message: "Google Trends RSS 실패 → mock (" + e.message + ")" };
  }
}

/* ---------- Trends24 (X/Twitter 한국 트렌드) ---------- */
async function trends24(settings) {
  const region = (settings.trends24 && settings.trends24.region) || "korea";
  const url = region === "seoul"
    ? (settings.trends24 && settings.trends24.seoul_url) || "https://trends24.in/korea/seoul/"
    : (settings.trends24 && settings.trends24.url) || "https://trends24.in/korea/";
  try {
    let html;
    try {
      html = await fetchText(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    } catch (firstErr) {
      // 재시도 최대 1회
      html = await fetchText(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    }
    const $ = cheerio.load(html);
    // 최신 트렌드 목록: ol.trend-card__list (구버전 .trend-card 도 호환)
    let list = $(".trend-card__list").first();
    if (list.length === 0) {
      const card = $(".trend-card").first();
      if (card.length) list = card.find("ol").first();
    }
    if (list.length === 0) throw new Error("트렌드 목록(.trend-card__list) 없음 (사이트 구조 변경 또는 차단 페이지)");
    const timeLabel = list.prevAll("h3, .trend-card__timestamp").first().text().trim() || "최신";
    const items = [];
    list.find("li a").each(function (i, a) {
      const kw = $(a).text().trim();
      if (kw) items.push({ keyword: kw, rank: items.length + 1, trend_time_label: timeLabel, region: region,
        source_url: region === "seoul" ? "https://trends24.in/korea/seoul/" : "https://trends24.in/korea/" });
    });
    if (items.length === 0) throw new Error("트렌드 항목이 비어 있음 (구조 변경 가능성)");
    return { ok: true, usedMock: false, items: items, message: "Trends24 수집 성공 (" + items.length + "건)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.trends24(region), message: "Trends24 실패 → mock (" + e.message + ")" };
  }
}

/* ---------- 네이버 데이터랩 ---------- */
async function naverDatalab(settings, keywordGroups) {
  if (!keywordGroups || keywordGroups.length === 0) {
    return { ok: false, usedMock: false, items: [], message: "네이버: 키워드 그룹 없음 (건너뜀)" };
  }
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return { ok: true, usedMock: true, items: mock.naverDatalab(keywordGroups, 14), message: "네이버: API 키 없음 → mock" };
  }
  try {
    const today = new Date();
    const start = new Date(today); start.setDate(today.getDate() - 30);
    const body = {
      startDate: start.toISOString().slice(0, 10),
      endDate: today.toISOString().slice(0, 10),
      timeUnit: "date",
      keywordGroups: keywordGroups.slice(0, 5).map(function (g) { return { groupName: g.groupName, keywords: g.keywords }; })
    };
    const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error("API HTTP " + res.status + " " + txt.slice(0, 120));
    }
    const json = await res.json();
    const rows = [];
    (json.results || []).forEach(function (r) {
      (r.data || []).forEach(function (d) {
        rows.push({ group_name: r.title, keyword_list: r.keywords || [], date: d.period, ratio: d.ratio, time_unit: json.timeUnit || "date" });
      });
    });
    if (rows.length === 0) throw new Error("응답에 데이터 없음");
    return { ok: true, usedMock: false, items: rows, message: "네이버 데이터랩 수집 성공 (" + rows.length + "행)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.naverDatalab(keywordGroups, 14), message: "네이버 API 실패 → mock (" + e.message + ")" };
  }
}

/* ---------- 네이버 검색 API 공용 ---------- */
async function naverSearch(kind, keyword, opts) {
  // kind: "blog" | "cafearticle"
  opts = opts || {};
  const display = Math.min(opts.display || 30, 100);
  const sort = opts.sort || "date";
  const url = "https://openapi.naver.com/v1/search/" + kind + ".json?query=" +
    encodeURIComponent(keyword) + "&display=" + display + "&start=1&sort=" + sort;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("HTTP " + res.status + " " + txt.slice(0, 120));
  }
  const json = await res.json();
  return json.items || [];
}

/* ---------- 네이버 블로그 검색 ---------- */
async function naverBlog(keyword, opts) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return { ok: true, usedMock: true, items: mock.naverBlog(keyword, 5), message: "블로그: API 키 없음 → mock" };
  }
  try {
    const raw = await naverSearch("blog", keyword, opts);
    const items = raw.map(function (it) {
      return {
        title: stripHtml(it.title),
        description: stripHtml(it.description),
        link: it.link,
        bloggername: stripHtml(it.bloggername || ""),
        bloggerlink: it.bloggerlink || "",
        postdate: it.postdate || ""
      };
    });
    return { ok: true, usedMock: false, items: items, message: "블로그 검색 성공 (" + items.length + "건)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.naverBlog(keyword, 5), message: "블로그 검색 실패 → mock (" + e.message + ")" };
  }
}

/* ---------- 네이버 카페글 검색 ---------- */
async function naverCafe(keyword, opts) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return { ok: true, usedMock: true, items: mock.naverCafe(keyword, 5), message: "카페: API 키 없음 → mock" };
  }
  try {
    const raw = await naverSearch("cafearticle", keyword, opts);
    const items = raw.map(function (it) {
      return {
        title: stripHtml(it.title),
        description: stripHtml(it.description),
        link: it.link,
        cafename: stripHtml(it.cafename || ""),
        cafeurl: it.cafeurl || ""
      };
    });
    return { ok: true, usedMock: false, items: items, message: "카페 검색 성공 (" + items.length + "건)" };
  } catch (e) {
    return { ok: true, usedMock: true, items: mock.naverCafe(keyword, 5), message: "카페 검색 실패 → mock (" + e.message + ")" };
  }
}

module.exports = { googleTrends, trends24, naverDatalab, naverBlog, naverCafe };
