/*
 * lib/http.js — API 핸들러 공통 유틸 (응답/에러/인증).
 */
function json(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(data));
}

function handleError(res, e) {
  if (e && e.code === "STORAGE") {
    return json(res, 503, {
      ok: false,
      error: "STORAGE_NOT_CONFIGURED",
      message: "저장소(Upstash Redis/KV)가 연결되지 않았습니다. Vercel 에서 Upstash 연동 후 재배포하세요. (README 참고)"
    });
  }
  console.error("[api] error:", e);
  return json(res, 500, { ok: false, error: "INTERNAL", message: String((e && e.message) || e) });
}

// 보호된 엔드포인트(수집/리포트 생성)용. CRON_SECRET 미설정 시 통과(개인용).
// Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 를 자동 전송한다.
// 외부 크론/수동 호출은 ?key=<CRON_SECRET> 로 허용한다.
function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers["authorization"] || "";
  if (auth === "Bearer " + secret) return true;
  const key = (req.query && req.query.key) || "";
  return key === secret;
}

module.exports = { json, handleError, isAuthorized };
