/*
 * GET /api/cron   — Vercel Cron 단일 진입점 (Hobby 플랜 호환: 하루 1회).
 * 동작: 수집 1회 + 일일 리포트 생성. KST 기준 월요일이면 주간, 매월 1일이면 월간도 생성.
 * (3회/일 수집이 필요하면 외부 크론으로 /api/collect 를 추가 호출하거나 Pro 플랜 사용 — README 참고)
 */
const { runCollect } = require("../lib/collect-service");
const report = require("../lib/report");
const { json, handleError, isAuthorized } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });

    const collect = await runCollect(true);

    const today = report.todayKst(); // YYYY-MM-DD (KST)
    const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0=일,1=월
    const dayOfMonth = Number(today.split("-")[2]);

    const generated = [];
    generated.push((await report.generate("daily")).report_type);
    if (dow === 1) generated.push((await report.generate("weekly")).report_type);
    if (dayOfMonth === 1) generated.push((await report.generate("monthly")).report_type);

    return json(res, 200, { ok: true, collect: collect, reports: generated });
  } catch (e) {
    return handleError(res, e);
  }
};
