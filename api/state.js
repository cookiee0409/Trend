/*
 * GET /api/state   전체 데이터 백업(내보내기)용 번들
 */
const store = require("../lib/store");
const { json, handleError } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    const data = await store.exportAll();
    return json(res, 200, { ok: true, data: data });
  } catch (e) {
    return handleError(res, e);
  }
};
