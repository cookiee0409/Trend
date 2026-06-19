/*
 * GET  /api/spam        최근 7일 스냅샷 기준 스팸 분류 현황 + 설정(mode/whitelist/extra_terms)
 * POST /api/spam        { action, ... } 로 관리
 *   - setMode      { mode: "observe"|"enforce" }
 *   - whitelist    { keyword }   해당(정규화) 키워드를 '정상'으로 표시(오탐 해제)
 *   - unwhitelist  { keyword }
 *   - addTerm      { term }      사용자 스팸어 추가
 *   - removeTerm   { term }
 */
const store = require("../lib/store");
const report = require("../lib/report");
const spam = require("../lib/spam");
const { normalizeKeyword } = require("../lib/normalize");
const { json, handleError } = require("../lib/http");

function getSf(cfg) {
  return Object.assign({ mode: "observe", extra_terms: [], whitelist: [] }, cfg.settings.spam_filter || {});
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const cfg = await store.getConfig();
      const sf = getSf(cfg);
      const opts = { extraTerms: sf.extra_terms, whitelist: sf.whitelist };

      // 최근 7일 스냅샷
      const today = report.todayKst();
      const from = report.kstDateStr(Date.now() - 7 * 86400000);
      const snaps = (await store.getSnapshots()).filter(function (s) {
        const d = report.kstDateStr(s.collected_at);
        return d >= from && d <= today;
      });

      // 정규화 키워드 단위로 집계 + 분류
      const map = {};
      snaps.forEach(function (s) {
        const nk = s.normalized_keyword || normalizeKeyword(s.keyword);
        if (!map[nk]) map[nk] = { keyword: s.keyword, normalized: nk, count: 0, sources: {} };
        map[nk].count++;
        map[nk].sources[s.source] = true;
      });

      const spamList = [];
      Object.keys(map).forEach(function (nk) {
        const m = map[nk];
        const c = spam.classify(m.keyword, opts);
        if (c.spam) {
          spamList.push({ keyword: m.keyword, normalized: nk, rule: c.rule, count: m.count, sources: Object.keys(m.sources) });
        }
      });
      spamList.sort(function (a, b) { return b.count - a.count; });

      return json(res, 200, {
        ok: true,
        mode: sf.mode,
        extra_terms: sf.extra_terms,
        whitelist: sf.whitelist,
        spam: spamList,
        scanned_keywords: Object.keys(map).length,
        period: { from: from, to: today }
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = req.body || {};
      const cfg = await store.getConfig();
      const sf = getSf(cfg);

      switch (body.action) {
        case "setMode":
          if (["observe", "enforce"].indexOf(body.mode) === -1) return json(res, 400, { ok: false, error: "INVALID_MODE" });
          sf.mode = body.mode;
          break;
        case "whitelist": {
          const nk = normalizeKeyword(body.keyword || "");
          if (!nk) return json(res, 400, { ok: false, error: "EMPTY" });
          if (sf.whitelist.indexOf(nk) === -1) sf.whitelist.push(nk);
          break;
        }
        case "unwhitelist": {
          const nk = normalizeKeyword(body.keyword || "");
          sf.whitelist = sf.whitelist.filter(function (x) { return x !== nk; });
          break;
        }
        case "addTerm": {
          const t = (body.term || "").trim();
          if (!t) return json(res, 400, { ok: false, error: "EMPTY" });
          if (sf.extra_terms.indexOf(t) === -1) sf.extra_terms.push(t);
          break;
        }
        case "removeTerm": {
          const t = (body.term || "").trim();
          sf.extra_terms = sf.extra_terms.filter(function (x) { return x !== t; });
          break;
        }
        default:
          return json(res, 400, { ok: false, error: "UNKNOWN_ACTION" });
      }

      cfg.settings.spam_filter = sf;
      await store.setConfig(cfg);
      return json(res, 200, { ok: true, mode: sf.mode, extra_terms: sf.extra_terms, whitelist: sf.whitelist });
    }

    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    return handleError(res, e);
  }
};
