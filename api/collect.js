/*
 * GET|POST /api/collect      모든 소스 수집 → KV 저장 (수동 / 외부 크론 공용)
 *   ?force=1   쿨다운 무시하고 강제 수집
 *   ?key=...   CRON_SECRET 설정 시 인증
 */
const { runCollect } = require("../lib/collect-service");
const { json, handleError, isAuthorized } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    const force = req.query && req.query.force === "1";
    // 비강제 수집은 20분 쿨다운으로 보호되므로 공개.
    // 쿨다운을 무시하는 force 수집만 CRON_SECRET 인증을 요구한다(외부 남용·쿼터 소모 방지).
    if (force && !isAuthorized(req)) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED", message: "force 수집은 ?key=<CRON_SECRET> 가 필요합니다." });
    }
    const result = await runCollect(force);
    return json(res, 200, Object.assign({ ok: true }, result));
  } catch (e) {
    return handleError(res, e);
  }
};
