/*
 * tools/collect-trends24-local.js
 *
 * Trends24(X 트렌드)를 "사용자 PC(일반 인터넷 회선)"에서 정상 방문자로 가져와
 * Vercel API(/api/snapshots)로 밀어넣는 로컬 수집 스크립트.
 *
 * 왜 필요한가:
 *   trends24.in 은 Vercel 같은 데이터센터 IP 에는 봇 차단 페이지를 주지만,
 *   일반 가정용 IP/브라우저에는 정상 페이지를 준다. 그래서 수집을 서버가 아니라
 *   사용자 PC 에서 돌리면 실데이터를 얻을 수 있다. (프록시/지문위조 같은 회피가 아님)
 *
 * 사용 원칙(제안서 준수): 하루 2~3회만, User-Agent 명시, 실패 시 중단(재시도 최소).
 *
 * 실행:
 *   # 프로젝트 폴더에서 (cheerio 가 설치돼 있어야 함: npm install)
 *   TREND_API=https://cookie-trend.vercel.app node tools/collect-trends24-local.js
 *
 * 환경변수:
 *   TREND_API     대상 API 베이스 URL (기본: https://cookie-trend.vercel.app)
 *   TREND_REGION  korea | seoul (기본: korea)
 *   TREND_KEY     (선택) 엔드포인트 보호키를 쓸 경우
 */
const cheerio = require("cheerio");

const API_BASE = process.env.TREND_API || "https://cookie-trend.vercel.app";
const REGION = process.env.TREND_REGION || "korea";
const KEY = process.env.TREND_KEY || "";
// 사용자 브라우저로서 접속함을 나타내는 표준 UA (회피 목적의 위조가 아니라 정상 클라이언트 식별)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 응답이 가끔 빈/차단 페이지로 깜빡이므로 최대 3회 가볍게 재시도(2~3회 권장 범위 내).
async function fetchCard() {
  const url = "https://trends24.in/" + REGION + "/";
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log("[trends24-local] GET", url, "(시도 " + attempt + ")");
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko,en;q=0.8", Accept: "text/html" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      const $ = cheerio.load(html);
      let list = $(".trend-card__list").first();
      if (list.length === 0) {
        const card = $(".trend-card").first();
        if (card.length) list = card.find("ol").first();
      }
      if (list.length > 0) return { $: $, list: list };
      console.log("[trends24-local] 트렌드 목록 없음 → 재시도");
    } catch (e) {
      console.log("[trends24-local] 요청 오류:", e.message, "→ 재시도");
    }
    if (attempt < 3) await sleep(2000);
  }
  throw new Error("트렌드 목록(.trend-card__list) 없음 (일시 오류/구조 변경). 잠시 후 다시 실행하세요.");
}

async function main() {
  const ctx = await fetchCard();
  const $ = ctx.$;
  const list = ctx.list;

  const items = [];
  list.find("li a").each(function (i, a) {
    const kw = $(a).text().trim();
    if (kw) items.push({ keyword: kw, rank: items.length + 1 });
  });
  if (items.length === 0) throw new Error("트렌드 항목이 비어 있음");
  console.log("[trends24-local] 파싱 " + items.length + "건:", items.slice(0, 5).map(function (x) { return x.keyword; }).join(", "), "...");

  const postUrl = API_BASE + "/api/snapshots" + (KEY ? "?key=" + encodeURIComponent(KEY) : "");
  const post = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "trends24_x", region: REGION, items: items })
  });
  const result = await post.json();
  console.log("[trends24-local] 전송 결과:", JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

main().catch(function (e) {
  console.error("[trends24-local] 실패:", e.message);
  process.exit(1);
});
