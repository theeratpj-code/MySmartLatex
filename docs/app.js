(function () {
  "use strict";

  // Refuse to run inside someone else's page (clickjacking).
  if (window.top !== window.self) { document.documentElement.hidden = true; return; }

  document.documentElement.classList.add("js");

  var cfg = window.APP_CONFIG || {};
  var SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
  var API = "https://sheets.googleapis.com/v4/spreadsheets/";
  var PAGE_SIZE = 100;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var $ = function (id) { return document.getElementById(id); };
  var token = null;          // in memory only, never stored
  var tokenClient = null;
  var idleTimer = null;
  var allTx = [];
  var state = { year: "all", planned: false, q: "", sort: "date", dir: "desc", page: 0 };
  var loadSeq = 0;
  var io = null;

  function configured() {
    return cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_ID.indexOf("PASTE_") === -1 &&
      cfg.SHEET_ID && cfg.SHEET_ID.indexOf("PASTE_") === -1 && /^[A-Za-z0-9_-]{20,}$/.test(cfg.SHEET_ID);
  }
  function setLoginMsg(m) { $("login-msg").textContent = m || ""; }
  function setStatus(m) { $("status").textContent = m || ""; }

  // ---- motion helpers ----------------------------------------------------
  function tween(el, to, fmt) {
    var from = typeof el._v === "number" ? el._v : 0;
    cancelAnimationFrame(el._raf);
    if (to === null || to === undefined) { el._v = null; el.textContent = "-"; return; }
    el._v = to;
    if (reduced || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 850;
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(step);
    })(t0);
  }

  function setupReveal() {
    var items = document.querySelectorAll("#app .reveal");
    Array.prototype.forEach.call(items, function (el, i) {
      if (!reduced) el.style.transitionDelay = (i % 4) * 70 + "ms";
    });
    if (!("IntersectionObserver" in window) || reduced) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add("in"); });
      return;
    }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  }
  function resetReveal() {
    Array.prototype.forEach.call(document.querySelectorAll("#app .reveal"), function (el) {
      el.classList.remove("in");
      if (io) io.observe(el);
    });
  }

  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      $("progress").style.transform = "scaleX(" + (h > 0 ? Math.min(1, window.scrollY / h) : 0) + ")";
      ticking = false;
    });
  }, { passive: true });

  // ---- idle sign-out -----------------------------------------------------
  function resetIdle() {
    if (!token) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { signOut("Signed out after inactivity."); }, (cfg.IDLE_MINUTES || 15) * 60000);
  }
  ["click", "keydown", "pointermove", "touchstart", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, resetIdle, { passive: true });
  });

  // ---- sign in / out -----------------------------------------------------
  function signOut(msg) {
    var t = token;
    token = null; allTx = []; loadSeq++;
    clearTimeout(idleTimer);
    Charts.hideTip();
    $("app").hidden = true; $("login").hidden = false;
    ["signout", "refresh", "updated"].forEach(function (id) { $(id).hidden = true; });
    $("table").replaceChildren(); $("recent").replaceChildren();
    ["ch-monthly", "ch-balance", "ch-latex", "top-in", "top-out", "spark"].forEach(function (id) { $(id).replaceChildren(); });
    ["k-bal", "k-in", "k-out", "k-net"].forEach(function (id) { $(id)._v = null; $(id).textContent = "-"; });
    $("q").value = ""; state.q = ""; state.page = 0;
    resetReveal();
    setStatus(""); setLoginMsg(msg || "");
    if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, function () {});
  }

  function onToken(resp) {
    if (!resp || resp.error) { setLoginMsg("Sign-in was cancelled or refused."); return; }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      setLoginMsg("Please allow read-only access to Google Sheets to continue."); return;
    }
    token = resp.access_token;
    $("login").hidden = true; $("app").hidden = false;
    $("signout").hidden = false; $("refresh").hidden = false;
    setLoginMsg(""); resetIdle(); load();
  }

  function initGoogle() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) { setTimeout(initGoogle, 100); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.GOOGLE_CLIENT_ID, scope: SCOPE, login_hint: cfg.LOGIN_HINT || undefined,
      callback: onToken,
      error_callback: function () { setLoginMsg("The Google sign-in window was closed or blocked."); }
    });
    $("signin").disabled = false;
  }

  // ---- loading -----------------------------------------------------------
  function sheetsGet() {
    var url = API + encodeURIComponent(cfg.SHEET_ID) + "/values:batchGet?valueRenderOption=UNFORMATTED_VALUE" +
      "&ranges=" + encodeURIComponent(cfg.DATA_TAB + "!A:R") + "&ranges=" + encodeURIComponent(cfg.META_TAB + "!A:B");
    return fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", referrerPolicy: "no-referrer" })
      .then(function (res) {
        if (res.status === 401) { signOut("Your session expired. Please sign in again."); throw new Error("expired"); }
        if (res.status === 403) throw new Error("Google refused access. Turn on the Google Sheets API for the project, and sign in with the account that owns the sheet.");
        if (res.status === 404) throw new Error("Sheet not found. Check SHEET_ID in config.js.");
        if (res.status === 400) throw new Error("The sheet needs tabs named " + cfg.DATA_TAB + " and " + cfg.META_TAB + ". Run the uploader once.");
        if (!res.ok) throw new Error("Google Sheets error (" + res.status + ").");
        return res.json();
      });
  }

  function load() {
    var seq = ++loadSeq;
    setStatus("Loading from Google Sheets...");
    sheetsGet().then(function (data) {
      if (seq !== loadSeq || !token) return;
      var vr = data.valueRanges || [];
      allTx = MSL.parse((vr[0] && vr[0].values) || []);
      var meta = {};
      ((vr[1] && vr[1].values) || []).forEach(function (r) { meta[r[0]] = r[1]; });
      if (meta.Updated) {
        var d = new Date(meta.Updated);
        $("updated-text").textContent = "Data updated " + (isNaN(d) ? meta.Updated : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
        $("updated").hidden = false;
      }
      buildYears();
      render();
    }).catch(function (e) {
      if (seq !== loadSeq || !token) return;
      setStatus(e && e.message === "expired" ? "" : (e && e.message) || "Could not load the data.");
    });
  }

  // ---- UI ----------------------------------------------------------------
  function buildYears() {
    var box = $("years"), pill = box.querySelector(".pill");
    box.replaceChildren(pill);
    ["all"].concat(MSL.years(allTx)).forEach(function (y) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = y === "all" ? "All time" : y; b.dataset.year = y;
      b.setAttribute("aria-pressed", String(state.year === y));
      b.addEventListener("click", function () { state.year = y; state.page = 0; render(); });
      box.appendChild(b);
    });
    requestAnimationFrame(movePill);
  }
  function movePill() {
    var active = $("years").querySelector('button[aria-pressed="true"]'), pill = $("years").querySelector(".pill");
    if (!active || !pill) return;
    pill.style.width = active.offsetWidth + "px";
    pill.style.transform = "translateX(" + active.offsetLeft + "px)";
  }
  window.addEventListener("resize", movePill);

  function money(v) { return "฿" + MSL.fmtMoney(v, 0); }
  function signed(v) { return (v > 0 ? "+" : v < 0 ? "-" : "") + "฿" + MSL.fmtMoney(Math.abs(v), 0); }

  function svgIcon(up) {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6");
    s.appendChild(p);
    return s;
  }

  function renderRecent(scoped) {
    var ul = $("recent");
    ul.replaceChildren();
    var recent = MSL.sortRows(scoped, "date", "desc").slice(0, 7);
    if (!recent.length) { var p = document.createElement("li"); p.className = "empty"; p.textContent = "No transactions in this view."; ul.appendChild(p); return; }
    recent.forEach(function (t, i) {
      var isIn = t.inAmt > 0 && t.outAmt === 0, li = document.createElement("li");
      li.className = "rc-item " + (isIn ? "rc-in" : "rc-out");
      if (!reduced) li.style.animationDelay = i * 55 + "ms";
      var ico = document.createElement("span"); ico.className = "rc-ico"; ico.appendChild(svgIcon(isIn));
      var txt = document.createElement("span"); txt.className = "rc-txt";
      var name = document.createElement("span"); name.className = "rc-name"; name.textContent = t.party || t.desc || "(no name)";
      var sub = document.createElement("span"); sub.className = "rc-sub"; sub.textContent = t.date + (t.party && t.desc ? " · " + t.desc : "");
      txt.appendChild(name); txt.appendChild(sub);
      var amt = document.createElement("span"); amt.className = "rc-amt"; amt.textContent = (isIn ? "+" : "-") + "฿" + MSL.fmtMoney(isIn ? t.inAmt : t.outAmt, 0);
      li.appendChild(ico); li.appendChild(txt); li.appendChild(amt);
      ul.appendChild(li);
    });
  }

  function render() {
    Array.prototype.forEach.call($("years").querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.year === state.year)); });
    movePill();
    var scoped = MSL.filter(allTx, { year: state.year, planned: state.planned, q: "" });
    var k = MSL.kpis(scoped);
    tween($("k-in"), k.inn, money);
    tween($("k-out"), k.out, money);
    tween($("k-net"), k.net, signed);
    $("k-net").className = "k-val " + (k.net >= 0 ? "pos" : "neg");
    tween($("k-bal"), k.closing, money);
    $("k-bal-label").textContent = state.year === "all" ? "Latest balance" : "Balance at end of " + state.year;
    var series = MSL.balanceSeries(scoped);
    $("k-bal-sub").textContent = series.length ? "as of " + series[series.length - 1].date : "";
    Charts.sparkline($("spark"), series);

    var tot = k.inn + k.out, pin = tot ? k.inn / tot * 100 : 0;
    $("split-in").style.width = pin + "%";
    $("split-out").style.width = (tot ? 100 - pin : 0) + "%";
    $("pct-in").textContent = tot ? pin.toFixed(0) + "%" : "-";
    $("pct-out").textContent = tot ? (100 - pin).toFixed(0) + "%" : "-";

    setStatus(scoped.length ? scoped.length + " transactions in this view" : "No transactions in this view.");

    var months = MSL.monthly(scoped);
    Charts.groupedBars($("ch-monthly"), months.map(function (m) { return { label: m.label, a: m.inn, b: m.out }; }), {
      label: "Money in and money out per month", aName: "In", bName: "Out", fmt: MSL.fmtShort, fmtFull: money
    });
    renderRecent(scoped);
    Charts.line($("ch-balance"), series, {
      label: "Account balance over time", fmt: MSL.fmtShort, fmtFull: money,
      dateLabel: function (iso) { return MSL.monthLabel(iso.slice(0, 7)); }
    });
    Charts.hbars($("top-in"), MSL.topParties(scoped, "inAmt", 8), { fmt: money, cls: "fill-a" });
    Charts.hbars($("top-out"), MSL.topParties(scoped, "outAmt", 8), { fmt: money, cls: "fill-b" });

    var L = MSL.latex(scoped);
    tween($("l-count"), L.count, function (v) { return String(Math.round(v)); });
    tween($("l-wet"), L.wetKg, function (v) { return MSL.fmtMoney(v, 0) + " kg"; });
    tween($("l-dry"), L.dryKg, function (v) { return MSL.fmtMoney(v, 0) + " kg"; });
    $("l-drc").textContent = L.drc === null ? "-" : L.drc.toFixed(1) + "%";
    $("l-price").textContent = L.avgPrice === null ? "-" : "฿" + MSL.fmtMoney(L.avgPrice, 2);
    tween($("l-spend"), L.spend, money);
    Charts.bars($("ch-latex"), months.map(function (m) { return { label: m.label, v: m.dryKg }; }), {
      label: "Dry rubber bought per month, in kilograms", cls: "bar-a", name: "Dry rubber",
      fmt: MSL.fmtShort, fmtFull: function (v) { return MSL.fmtMoney(v, 0) + " kg"; }
    });

    renderTable();
  }

  var COLS = [
    { key: "date", label: "Date" }, { key: "party", label: "Paid to / Received from" },
    { key: "desc", label: "Description" },
    { key: "inAmt", label: "In", num: true }, { key: "outAmt", label: "Out", num: true },
    { key: "balance", label: "Balance", num: true }
  ];

  function renderTable() {
    var list = MSL.filter(allTx, { year: state.year, planned: state.planned, q: state.q });
    list = MSL.sortRows(list, state.sort, state.dir);
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    var table = $("table");
    table.replaceChildren();
    var hr = table.createTHead().insertRow();
    COLS.forEach(function (c) {
      var th = document.createElement("th");
      th.scope = "col";
      if (c.num) th.className = "num";
      var b = document.createElement("button");
      b.type = "button"; b.className = "th-btn"; b.textContent = c.label;
      if (state.sort === c.key) { th.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending"); b.textContent += state.dir === "asc" ? " ↑" : " ↓"; }
      b.addEventListener("click", function () {
        if (state.sort === c.key) state.dir = state.dir === "asc" ? "desc" : "asc";
        else { state.sort = c.key; state.dir = c.key === "date" || c.num ? "desc" : "asc"; }
        state.page = 0; renderTable();
      });
      th.appendChild(b); hr.appendChild(th);
    });
    var tb = table.createTBody();
    slice.forEach(function (t) {
      var tr = tb.insertRow();
      if (t.planned) tr.className = "planned";
      COLS.forEach(function (c) {
        var td = tr.insertCell(), v = t[c.key];
        if (c.num) {
          td.className = "num " + (c.key === "inAmt" ? "pos" : c.key === "outAmt" ? "neg" : "");
          td.textContent = v === null || v === 0 ? "" : MSL.fmtMoney(v, 2);
        } else {
          td.textContent = v;
          if (c.key === "date" && t.planned) {
            var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "Planned";
            td.appendChild(tag);
          }
        }
      });
    });
    $("tx-count").textContent = list.length + (list.length === 1 ? " transaction" : " transactions");
    $("page-info").textContent = "Page " + (state.page + 1) + " of " + pages;
    $("prev").disabled = state.page === 0;
    $("next").disabled = state.page >= pages - 1;
  }

  // ---- events ------------------------------------------------------------
  $("signin").addEventListener("click", function () { setLoginMsg(""); if (tokenClient) tokenClient.requestAccessToken(); });
  $("signout").addEventListener("click", function () { signOut("You have signed out."); });
  $("refresh").addEventListener("click", load);
  $("planned").addEventListener("change", function (e) { state.planned = e.target.checked; state.page = 0; render(); });
  var qTimer = null;
  $("q").addEventListener("input", function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = e.target.value; state.page = 0; renderTable(); }, 150);
  });
  $("prev").addEventListener("click", function () { state.page--; renderTable(); });
  $("next").addEventListener("click", function () { state.page++; renderTable(); });

  setupReveal();
  if (!configured()) setLoginMsg("This site is not set up yet. Fill in docs/config.js with the Client ID and the Sheet ID.");
  else initGoogle();
})();
