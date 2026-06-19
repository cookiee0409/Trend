/*
 * GET   /api/candidates           키워드 후보 전체 조회
 * PATCH /api/candidates?id=...     { status?, memo? } 상태/메모 변경
 */
const store = require("../lib/store");
const { json, handleError } = require("../lib/http");

const VALID_STATUS = ["new", "watching", "ignored", "added_to_naver"];

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const list = await store.getCandidates();
      return json(res, 200, { ok: true, candidates: list });
    }
    if (req.method === "PATCH" || req.method === "POST") {
      const id = req.query && req.query.id;
      const body = req.body || {};
      if (!id) return json(res, 400, { ok: false, error: "MISSING_ID" });
      const patch = {};
      if (body.status && VALID_STATUS.indexOf(body.status) !== -1) patch.status = body.status;
      if (typeof body.memo === "string") patch.memo = body.memo;
      await store.updateCandidate(id, patch);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    return handleError(res, e);
  }
};
