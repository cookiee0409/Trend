/*
 * GET  /api/config        설정 + 키워드 그룹 조회
 * PUT  /api/config        { settings, keywords } 저장
 */
const store = require("../lib/store");
const { json, handleError } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const cfg = await store.getConfig();
      return json(res, 200, { ok: true, config: cfg });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body = req.body || {};
      const current = await store.getConfig();
      const next = {
        settings: body.settings ? Object.assign({}, current.settings, body.settings) : current.settings,
        keywords: Array.isArray(body.keywords) ? body.keywords : current.keywords
      };
      await store.setConfig(next);
      return json(res, 200, { ok: true, config: next });
    }
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    return handleError(res, e);
  }
};
