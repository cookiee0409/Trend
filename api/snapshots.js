/*
 * GET  /api/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD   (KST 날짜 기준 필터, 미지정 시 전체)
 * POST /api/snapshots   { source, region, items:[{keyword, rank?}] }   수동 입력(수집 실패 대체)
 */
const store = require("../lib/store");
const report = require("../lib/report");
const { normalizeKeyword } = require("../lib/normalize");
const { json, handleError } = require("../lib/http");

// 북마클릿(trends24.in 등 다른 출처)에서 수동 입력 POST 를 허용하기 위한 CORS.
// 이 엔드포인트는 데이터 추가만 하므로 개인용 범위에서 전체 허용해도 무방하다.
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method === "GET") {
      const all = await store.getSnapshots();
      const from = req.query && req.query.from;
      const to = req.query && req.query.to;
      const filtered = all.filter(function (s) {
        const d = report.kstDateStr(s.collected_at);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
      return json(res, 200, { ok: true, snapshots: filtered });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const source = body.source || "trends24_x";
      const region = body.region || "korea";
      const now = new Date().toISOString();
      const items = (body.items || []).filter(function (it) { return it && it.keyword; });
      if (items.length === 0) return json(res, 400, { ok: false, error: "EMPTY", message: "items 가 비어 있습니다." });

      const snaps = items.map(function (it, i) {
        return {
          source: source, keyword: it.keyword, normalized_keyword: normalizeKeyword(it.keyword),
          rank: it.rank || i + 1, score: null, metric_text: "", region: region, category: "",
          collected_at: now, source_url: "manual_input", raw_data: JSON.stringify(it)
        };
      });
      const added = await store.addSnapshots(snaps);
      await store.upsertCandidates(snaps.map(function (s) { return { keyword: s.keyword, normalized_keyword: s.normalized_keyword, source: s.source }; }));
      return json(res, 200, { ok: true, added: added });
    }

    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    return handleError(res, e);
  }
};
