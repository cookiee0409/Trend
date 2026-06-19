/*
 * GET /api/naver   네이버 데이터랩 결과 전체 조회
 */
const store = require("../lib/store");
const { json, handleError } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    const rows = await store.getNaver();
    return json(res, 200, { ok: true, naver: rows });
  } catch (e) {
    return handleError(res, e);
  }
};
