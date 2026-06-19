/*
 * GET|POST /api/collect      모든 소스 수집 → KV 저장 (수동 / 외부 크론 공용)
 *   ?force=1   쿨다운 무시하고 강제 수집
 *   ?key=...   CRON_SECRET 설정 시 인증
 */
const { runCollect } = require("../lib/collect-service");
const { json, handleError, isAuthorized } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
    const force = req.query && req.query.force === "1";
    const result = await runCollect(force);
    return json(res, 200, Object.assign({ ok: true }, result));
  } catch (e) {
    return handleError(res, e);
  }
};
