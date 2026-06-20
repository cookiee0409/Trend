/*
 * js/api.js — 서버리스 API(/api/*) 호출 래퍼.
 */
(function (global) {
  "use strict";

  async function req(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: "BAD_JSON" }; }
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && data.message) || (data && data.error) || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const API = {
    getConfig: function () { return req("/api/config"); },
    saveConfig: function (settings, keywords) {
      return req("/api/config", { method: "PUT", body: JSON.stringify({ settings: settings, keywords: keywords }) });
    },
    collect: function (force) { return req("/api/collect" + (force ? "?force=1" : ""), { method: "POST" }); },
    getSnapshots: function (from, to) {
      let q = [];
      if (from) q.push("from=" + from);
      if (to) q.push("to=" + to);
      return req("/api/snapshots" + (q.length ? "?" + q.join("&") : ""));
    },
    addManualSnapshots: function (source, region, items) {
      return req("/api/snapshots", { method: "POST", body: JSON.stringify({ source: source, region: region, items: items }) });
    },
    getNaver: function () { return req("/api/naver"); },
    getCandidates: function () { return req("/api/candidates"); },
    updateCandidate: function (id, patch) {
      return req("/api/candidates?id=" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
    },
    getReports: function () { return req("/api/reports"); },
    generateReport: function (type) { return req("/api/reports", { method: "POST", body: JSON.stringify({ type: type }) }); },
    deleteReport: function (id) { return req("/api/reports?id=" + encodeURIComponent(id), { method: "DELETE" }); },
    getState: function () { return req("/api/state"); },
    getSpam: function () { return req("/api/spam"); },
    spamAction: function (payload) { return req("/api/spam", { method: "POST", body: JSON.stringify(payload) }); },
    getPostsSummary: function (from, to) {
      let q = ["summary=1"];
      if (from) q.push("from=" + from);
      if (to) q.push("to=" + to);
      return req("/api/posts?" + q.join("&"));
    },
    getPosts: function (type, keyword) {
      return req("/api/posts?type=" + encodeURIComponent(type) + "&keyword=" + encodeURIComponent(keyword));
    }
  };

  global.API = API;
})(window);
