/*
 * GET    /api/reports                      리포트 목록
 * GET    /api/reports?type=daily&generate=1   해당 타입 리포트 생성(크론용) 후 반환
 * POST   /api/reports   { type: daily|weekly|monthly }   리포트 생성(버튼용)
 * DELETE /api/reports?id=...                리포트 삭제
 */
const store = require("../lib/store");
const report = require("../lib/report");
const { json, handleError, isAuthorized } = require("../lib/http");

const VALID = ["daily", "weekly", "monthly"];

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (q.generate && VALID.indexOf(q.type) !== -1) {
        // 크론(GET)으로 생성
        if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
        const r = await report.generate(q.type);
        return json(res, 200, { ok: true, report: r });
      }
      const list = await store.getReports();
      return json(res, 200, { ok: true, reports: list });
    }

    if (req.method === "POST") {
      const type = (req.body && req.body.type) || "";
      if (VALID.indexOf(type) === -1) return json(res, 400, { ok: false, error: "INVALID_TYPE" });
      const r = await report.generate(type);
      return json(res, 200, { ok: true, report: r });
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return json(res, 400, { ok: false, error: "MISSING_ID" });
      await store.deleteReport(id);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    return handleError(res, e);
  }
};
