/*
 * js/app.js — 대시보드 (서버 API 기반, 얇은 뷰).
 * 데이터/로직은 모두 /api/* (서버리스 + KV)에 있다.
 */
(function (global) {
  "use strict";

  const API = global.API;

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function log(msg, kind) {
    const box = $("#log-box");
    if (!box) return;
    const ts = new Date().toLocaleTimeString("ko-KR");
    box.insertBefore(el("div", { class: "log-line " + (kind || "") }, "[" + ts + "] " + esc(msg)), box.firstChild);
  }
  function kstToday() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  // 캐시
  let state = { config: null, reports: [], candidates: [], naver: [], todaySnaps: [], spam: null };

  /* ---------- 수집 ---------- */
  async function collect() {
    log("수집 요청...", "info");
    try {
      const r = await API.collect(false);
      if (r.skipped) {
        const mins = r.last_collect_at ? Math.round((Date.now() - new Date(r.last_collect_at).getTime()) / 60000) : "?";
        log("최근(" + mins + "분 전) 이미 수집됨 — 중복 방지로 건너뜁니다. 기존 데이터를 표시합니다.", "warn");
      } else {
        (r.log || []).forEach(function (l) {
          log(l.source + ": " + l.message + " → 신규 " + l.added + "건" + (l.mock ? " (mock)" : ""), l.mock ? "warn" : "ok");
        });
        log("수집 완료.", "info");
      }
      await refreshData();
      renderAll();
    } catch (e) {
      log("수집 실패: " + e.message, "error");
    }
  }

  /* ---------- 데이터 로드 ---------- */
  async function refreshData() {
    const today = kstToday();
    const [cfg, snaps, naver, cands, reps, spamData] = await Promise.all([
      API.getConfig(), API.getSnapshots(today, today), API.getNaver(), API.getCandidates(), API.getReports(), API.getSpam()
    ]);
    state.config = cfg.config;
    state.todaySnaps = snaps.snapshots;
    state.naver = naver.naver;
    state.candidates = cands.candidates;
    state.reports = reps.reports;
    state.spam = spamData;
  }

  /* ---------- 화면 1: 오늘의 트렌드 ---------- */
  function renderToday() {
    const snaps = state.todaySnaps;
    function tableFor(source) {
      const rows = snaps.filter(function (s) { return s.source === source; })
        .sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });
      if (rows.length === 0) return "<p class='muted'>오늘 수집된 데이터가 없습니다. [수집 실행]을 눌러보세요.</p>";
      let html = "<table><thead><tr><th>순위</th><th>키워드</th><th>지표</th></tr></thead><tbody>";
      rows.slice(0, 20).forEach(function (s) {
        html += "<tr><td>" + (s.rank || "-") + "</td><td>" + esc(s.keyword) + "</td><td class='muted'>" + esc(s.metric_text || s.region || "") + "</td></tr>";
      });
      return html + "</tbody></table>";
    }
    $("#today-google").innerHTML = tableFor("google_trends");
    $("#today-x").innerHTML = tableFor("trends24_x");

    const byGroup = {};
    state.naver.forEach(function (r) { (byGroup[r.group_name] = byGroup[r.group_name] || []).push(r); });
    const groups = Object.keys(byGroup);
    if (groups.length === 0) {
      $("#today-naver").innerHTML = "<p class='muted'>네이버 데이터랩 데이터가 없습니다.</p>";
    } else {
      let h = "<table><thead><tr><th>그룹</th><th>최근 ratio</th><th>직전 대비</th></tr></thead><tbody>";
      groups.forEach(function (g) {
        const rows = byGroup[g].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        const latest = rows[rows.length - 1].ratio;
        const prev = rows.length >= 2 ? rows[rows.length - 2].ratio : latest;
        const delta = latest - prev;
        const cls = delta > 0 ? "up" : (delta < 0 ? "down" : "");
        h += "<tr><td>" + esc(g) + "</td><td>" + latest + "</td><td class='" + cls + "'>" + (delta >= 0 ? "+" : "") + delta + "</td></tr>";
      });
      $("#today-naver").innerHTML = h + "</tbody></table>";
    }

    const today = kstToday();
    const newC = state.candidates.filter(function (c) {
      return new Date(new Date(c.first_seen_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) === today;
    });
    $("#today-new").innerHTML = newC.length === 0
      ? "<p class='muted'>오늘 새로 발견된 키워드가 없습니다.</p>"
      : newC.slice(0, 30).map(function (c) { return "<span class='chip'>" + esc(c.keyword) + "</span>"; }).join(" ");
  }

  /* ---------- 화면 2: 리포트 ---------- */
  function renderReports() {
    const list = $("#report-list");
    list.innerHTML = "";
    if (state.reports.length === 0) {
      list.innerHTML = "<p class='muted'>생성된 리포트가 없습니다.</p>";
      $("#report-view").innerHTML = "";
      return;
    }
    state.reports.forEach(function (r) {
      const item = el("div", { class: "report-item", "data-id": r.id });
      item.innerHTML = "<span class='badge badge-" + r.report_type + "'>" + r.report_type + "</span> " +
        esc(r.title) + "<br><small class='muted'>" + esc(r.summary || "") + "</small>";
      item.addEventListener("click", function () { viewReport(r.id); });
      list.appendChild(item);
    });
    viewReport(state.reports[0].id);
  }

  function viewReport(id) {
    const r = state.reports.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    $all(".report-item").forEach(function (n) { n.classList.toggle("active", n.getAttribute("data-id") === id); });
    const view = $("#report-view");
    view.innerHTML = "";
    const tb = el("div", { class: "toolbar" });
    const copy = el("button", { class: "btn" }, "📋 복사");
    copy.addEventListener("click", function () { navigator.clipboard.writeText(r.content_markdown).then(function () { log("복사됨.", "ok"); }); });
    const dl = el("button", { class: "btn" }, "⬇ .md");
    dl.addEventListener("click", function () { downloadText(r.title + ".md", r.content_markdown); });
    const del = el("button", { class: "btn btn-danger" }, "🗑 삭제");
    del.addEventListener("click", async function () {
      if (!confirm("이 리포트를 삭제할까요?")) return;
      try { await API.deleteReport(id); state.reports = (await API.getReports()).reports; renderReports(); } catch (e) { log("삭제 실패: " + e.message, "error"); }
    });
    tb.appendChild(copy); tb.appendChild(dl); tb.appendChild(del);
    view.appendChild(tb);
    const pre = el("pre", { class: "markdown" });
    pre.textContent = r.content_markdown;
    view.appendChild(pre);
  }

  async function genReport(type) {
    try {
      await API.generateReport(type);
      state.reports = (await API.getReports()).reports;
      renderReports();
      log(type + " 리포트를 생성했습니다.", "ok");
    } catch (e) { log("리포트 생성 실패: " + e.message, "error"); }
  }

  /* ---------- 화면 3: 키워드 후보 ---------- */
  function renderCandidates() {
    const box = $("#candidate-list");
    const cands = state.candidates.slice().sort(function (a, b) { return (b.seen_count || 0) - (a.seen_count || 0); });
    if (cands.length === 0) { box.innerHTML = "<p class='muted'>키워드 후보가 없습니다.</p>"; return; }
    let html = "<table><thead><tr><th>키워드</th><th>등장</th><th>소스</th><th>상태</th><th>변경</th></tr></thead><tbody>";
    cands.forEach(function (c) {
      html += "<tr><td>" + esc(c.keyword) + "</td><td>" + (c.seen_count || 0) + "</td><td class='muted'>" + esc((c.sources || []).join(", ")) + "</td>" +
        "<td><span class='status status-" + c.status + "'>" + c.status + "</span></td>" +
        "<td><select data-id='" + c.id + "' class='cand-status'>" +
        ["new", "watching", "ignored", "added_to_naver"].map(function (s) {
          return "<option value='" + s + "'" + (c.status === s ? " selected" : "") + ">" + s + "</option>";
        }).join("") + "</select></td></tr>";
    });
    box.innerHTML = html + "</tbody></table>";
    $all(".cand-status").forEach(function (sel) {
      sel.addEventListener("change", async function () {
        try {
          await API.updateCandidate(sel.getAttribute("data-id"), { status: sel.value });
          state.candidates = (await API.getCandidates()).candidates;
          renderCandidates();
          log("후보 상태 변경: " + sel.value, "ok");
        } catch (e) { log("상태 변경 실패: " + e.message, "error"); }
      });
    });
  }

  /* ---------- 화면 4: 스팸 분류 ---------- */
  function renderSpam() {
    const s = state.spam;
    if (!s) return;
    $all("input[name='spam-mode']").forEach(function (r) { r.checked = (r.value === s.mode); });
    $("#spam-period").textContent = "분류 대상: 최근 7일 스냅샷 (" + (s.period ? s.period.from + " ~ " + s.period.to : "") + "), 검사한 키워드 " + (s.scanned_keywords || 0) + "개";
    $("#spam-count").textContent = "(" + (s.spam || []).length + "건" + (s.mode === "observe" ? " · 관찰 모드: 리포트에 아직 반영 안 됨" : " · 정식 적용 중: 리포트에서 제외") + ")";

    // 분류된 스팸 목록
    if (!s.spam || s.spam.length === 0) {
      $("#spam-list").innerHTML = "<p class='muted'>스팸으로 분류된 키워드가 없습니다.</p>";
    } else {
      let html = "<table><thead><tr><th>키워드</th><th>매칭 규칙</th><th>등장</th><th>소스</th><th></th></tr></thead><tbody>";
      s.spam.forEach(function (it) {
        html += "<tr><td>" + esc(it.keyword) + "</td><td><span class='status status-watching'>" + esc(it.rule) + "</span></td>" +
          "<td>" + it.count + "</td><td class='muted'>" + esc((it.sources || []).join(", ")) + "</td>" +
          "<td><button class='btn secondary btn-whitelist' data-kw='" + esc(it.keyword) + "'>정상으로 표시</button></td></tr>";
      });
      $("#spam-list").innerHTML = html + "</tbody></table>";
      $all(".btn-whitelist").forEach(function (b) {
        b.addEventListener("click", async function () {
          try { await API.spamAction({ action: "whitelist", keyword: b.getAttribute("data-kw") }); await reloadSpam(); log("화이트리스트에 추가(정상 처리)", "ok"); }
          catch (e) { log("처리 실패: " + e.message, "error"); }
        });
      });
    }

    // 화이트리스트
    if (!s.whitelist || s.whitelist.length === 0) {
      $("#spam-whitelist").innerHTML = "<p class='muted'>없음</p>";
    } else {
      $("#spam-whitelist").innerHTML = s.whitelist.map(function (w) {
        return "<span class='chip'>" + esc(w) + " <a href='#' class='wl-remove' data-kw='" + esc(w) + "'>×</a></span>";
      }).join(" ");
      $all(".wl-remove").forEach(function (a) {
        a.addEventListener("click", async function (ev) {
          ev.preventDefault();
          try { await API.spamAction({ action: "unwhitelist", keyword: a.getAttribute("data-kw") }); await reloadSpam(); log("화이트리스트에서 제거", "ok"); }
          catch (e) { log("처리 실패: " + e.message, "error"); }
        });
      });
    }

    // 사용자 스팸어
    if (!s.extra_terms || s.extra_terms.length === 0) {
      $("#spam-terms").innerHTML = "<p class='muted'>추가된 스팸어 없음</p>";
    } else {
      $("#spam-terms").innerHTML = s.extra_terms.map(function (t) {
        return "<span class='chip'>" + esc(t) + " <a href='#' class='term-remove' data-term='" + esc(t) + "'>×</a></span>";
      }).join(" ");
      $all(".term-remove").forEach(function (a) {
        a.addEventListener("click", async function (ev) {
          ev.preventDefault();
          try { await API.spamAction({ action: "removeTerm", term: a.getAttribute("data-term") }); await reloadSpam(); log("스팸어 제거", "ok"); }
          catch (e) { log("처리 실패: " + e.message, "error"); }
        });
      });
    }
  }

  async function reloadSpam() {
    state.spam = await API.getSpam();
    renderSpam();
  }

  /* ---------- 화면 5: 설정 ---------- */
  function renderSettings() {
    if (!state.config) return;
    const s = state.config.settings;
    $("#set-collect-times").value = (s.collect_times || []).join(", ");
    $("#set-geo").value = s.google_trends.geo;
    $("#set-trends24-region").value = s.trends24.region;
    $("#set-keywords").value = JSON.stringify(state.config.keywords, null, 2);
  }

  async function saveSettings() {
    const s = JSON.parse(JSON.stringify(state.config.settings));
    s.collect_times = $("#set-collect-times").value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    s.google_trends.geo = $("#set-geo").value.trim() || "KR";
    s.google_trends.rss_url = "https://trends.google.com/trending/rss?geo=" + s.google_trends.geo;
    s.trends24.region = $("#set-trends24-region").value;
    let keywords;
    try { keywords = JSON.parse($("#set-keywords").value); }
    catch (e) { log("키워드 JSON 오류: " + e.message, "error"); return; }
    try {
      const r = await API.saveConfig(s, keywords);
      state.config = r.config;
      log("설정을 저장했습니다.", "ok");
    } catch (e) { log("설정 저장 실패: " + e.message, "error"); }
  }

  /* ---------- 유틸 ---------- */
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function renderAll() {
    renderToday();
    renderReports();
    renderCandidates();
    renderSpam();
    renderSettings();
  }

  function setupTabs() {
    $all(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        const target = tab.getAttribute("data-tab");
        $all(".tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        $all(".panel").forEach(function (p) { p.classList.toggle("active", p.id === "panel-" + target); });
      });
    });
  }

  async function init() {
    setupTabs();

    $("#btn-collect").addEventListener("click", collect);
    $("#btn-report-daily").addEventListener("click", function () { genReport("daily"); });
    $("#btn-report-weekly").addEventListener("click", function () { genReport("weekly"); });
    $("#btn-report-monthly").addEventListener("click", function () { genReport("monthly"); });
    $("#btn-save-settings").addEventListener("click", saveSettings);

    // 스팸 분류
    $all("input[name='spam-mode']").forEach(function (r) {
      r.addEventListener("change", async function () {
        if (!r.checked) return;
        try {
          await API.spamAction({ action: "setMode", mode: r.value });
          await reloadSpam();
          log("스팸 필터 모드: " + (r.value === "enforce" ? "정식 적용(리포트 제외)" : "관찰"), "ok");
        } catch (e) { log("모드 변경 실패: " + e.message, "error"); }
      });
    });
    $("#btn-add-term").addEventListener("click", async function () {
      const t = $("#spam-term-input").value.trim();
      if (!t) return;
      try { await API.spamAction({ action: "addTerm", term: t }); $("#spam-term-input").value = ""; await reloadSpam(); log("스팸어 추가: " + t, "ok"); }
      catch (e) { log("추가 실패: " + e.message, "error"); }
    });

    $("#btn-export").addEventListener("click", async function () {
      try {
        const r = await API.getState();
        downloadText("trend-backup-" + kstToday() + ".json", JSON.stringify(r.data, null, 2));
      } catch (e) { log("내보내기 실패: " + e.message, "error"); }
    });

    $("#btn-manual-trends24").addEventListener("click", async function () {
      const lines = $("#manual-trends24").value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length === 0) { log("입력된 키워드가 없습니다.", "warn"); return; }
      try {
        const items = lines.map(function (kw, i) { return { keyword: kw, rank: i + 1 }; });
        const r = await API.addManualSnapshots("trends24_x", state.config.settings.trends24.region, items);
        log("Trends24 수동 입력 저장: " + r.added + "건", "ok");
        $("#manual-trends24").value = "";
        await refreshData(); renderAll();
      } catch (e) { log("수동 입력 실패: " + e.message, "error"); }
    });

    try {
      await refreshData();
      renderAll();
      log("로드 완료. [수집 실행]으로 최신 트렌드를 가져오세요.", "info");
    } catch (e) {
      log("초기 로드 실패: " + e.message, "error");
      if (e.status === 503) {
        log("→ Vercel 에 Upstash(KV) 연동이 필요합니다. README의 배포 단계를 확인하세요.", "warn");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  global.TrendApp = { collect: collect, refreshData: refreshData, renderAll: renderAll };
})(window);
