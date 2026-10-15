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
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  var $ = function (id) { return document.getElementById(id); };
  var token = null;          // in memory only, never stored
  var tokenClient = null;
  var idleTick = null, lastActivity = 0;
  var allTx = [];
  var state = { year: "all", month: null, planned: false, q: "", sort: "date", dir: "desc", page: 0 };
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

  // one shared rAF-throttled scroll handler
  var scrollTicking = false;
  window.addEventListener("scroll", function () {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      $("progress").style.transform = "scaleX(" + (h > 0 ? Math.min(1, window.scrollY / h) : 0) + ")";
      scrollTicking = false;
    });
  }, { passive: true });

  // pause infinite animations while the tab is hidden
  document.addEventListener("visibilitychange", function () {
    document.documentElement.classList.toggle("page-hidden", document.hidden);
  });

  // ---- pointer effects (mouse only, never on touch or with reduced motion) -
  if (finePointer && !reduced) {
    // spotlight under the cursor on cards
    var spot = null, spotX = 0, spotY = 0, spotRaf = false;
    document.addEventListener("pointermove", function (e) {
      var card = e.target.closest ? e.target.closest(".card") : null;
      if (!card) return;
      spot = card; spotX = e.clientX; spotY = e.clientY;
      if (spotRaf) return;
      spotRaf = true;
      requestAnimationFrame(function () {
        spotRaf = false;
        var r = spot.getBoundingClientRect();
        spot.style.setProperty("--mx", (spotX - r.left) + "px");
        spot.style.setProperty("--my", (spotY - r.top) + "px");
      });
    }, { passive: true });

    // tilt on the login illustration
    var art = $("hero-art"), panel = art.querySelector(".art-panel");
    art.addEventListener("pointermove", function (e) {
      var r = art.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      requestAnimationFrame(function () {
        panel.style.setProperty("--ry", (px * 9).toFixed(2) + "deg");
        panel.style.setProperty("--rx", (-py * 9).toFixed(2) + "deg");
      });
    }, { passive: true });
    art.addEventListener("pointerleave", function () {
      panel.style.setProperty("--ry", "0deg"); panel.style.setProperty("--rx", "0deg");
    });

    // magnetic sign-in button
    var btn = $("signin"), cta = btn.parentNode;
    cta.addEventListener("pointermove", function (e) {
      var r = btn.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      var dist = Math.sqrt(dx * dx + dy * dy);
      var pull = dist < 140 ? 0.18 : 0;
      btn.style.setProperty("--tx", (dx * pull).toFixed(1) + "px");
      btn.style.setProperty("--ty", (dy * pull).toFixed(1) + "px");
    }, { passive: true });
    cta.addEventListener("pointerleave", function () {
      btn.style.setProperty("--tx", "0px"); btn.style.setProperty("--ty", "0px");
    });
  }

  // ---- idle sign-out: cheap timestamp on activity, one timer checks it ----
  function touch() { lastActivity = Date.now(); }
  ["click", "keydown", "pointermove", "touchstart", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, touch, { passive: true });
  });
  function startIdle() {
    touch(); clearInterval(idleTick);
    idleTick = setInterval(function () {
      if (token && Date.now() - lastActivity > (cfg.IDLE_MINUTES || 15) * 60000) signOut("Signed out after inactivity.");
    }, 15000);
  }

  // ---- sign in / out -----------------------------------------------------
  function signOut(msg) {
    var t = token;
    token = null; allTx = []; loadSeq++;
    clearInterval(idleTick);
    Charts.hideTip();
    $("app").hidden = true; $("login").hidden = false;
    ["signout", "refresh", "updated"].forEach(function (id) { $(id).hidden = true; });
    $("table").replaceChildren(); $("recent").replaceChildren(); $("stream").replaceChildren();
    ["ch-monthly", "ch-balance", "ch-mg", "top-in", "top-out", "spark"].forEach(function (id) { $(id).replaceChildren(); });
    ["k-bal", "k-in", "k-out", "k-net"].forEach(function (id) { $(id)._v = null; $(id).textContent = "-"; });
    $("q").value = ""; state.q = ""; state.page = 0; state.month = null; state.year = "all";
    $("error").hidden = true; $("dash").hidden = false;
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
    setLoginMsg(""); startIdle(); load();
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
  function authFetch(url) {
    return fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", referrerPolicy: "no-referrer" })
      .then(function (res) {
        if (res.status === 401) { signOut("Your session expired. Please sign in again."); throw new Error("expired"); }
        if (res.status === 403) throw new Error("Google would not let this account read the sheet. Ask the owner to add your email to the Viewers tab, and check the Google Sheets API is on.");
        if (res.status === 404) throw new Error("Sheet not found. Check SHEET_ID in config.js.");
        if (res.status === 400) throw new Error("The sheet's tabs could not be read. Run the uploader once.");
        if (!res.ok) throw new Error("Google Sheets error (" + res.status + ").");
        return res.json();
      });
  }

  // 1) list the tabs, 2) read every year tab (named 2024, 2025, ...) plus Meta, so a new year needs no change here
  function sheetsGet() {
    var base = API + encodeURIComponent(cfg.SHEET_ID);
    return authFetch(base + "?fields=sheets.properties.title").then(function (info) {
      var years = (info.sheets || []).map(function (s) { return s.properties.title; })
        .filter(function (t) { return /^\d{4}$/.test(t); }).sort();
      if (!years.length) throw new Error("The sheet has no year tabs yet. Run the uploader once.");
      var qs = "valueRenderOption=UNFORMATTED_VALUE" +
        years.map(function (y) { return "&ranges=" + encodeURIComponent("'" + y + "'!A:R"); }).join("") +
        "&ranges=" + encodeURIComponent(cfg.META_TAB + "!A:B");
      return authFetch(base + "/values:batchGet?" + qs).then(function (data) { return { years: years, data: data }; });
    });
  }

  function showError(msg) {
    $("app").classList.remove("is-loading");
    $("dash").hidden = true; $("error").hidden = false;
    $("error-text").textContent = msg;
    setStatus("");
    $("updated").classList.remove("busy");
  }

  function load() {
    var seq = ++loadSeq;
    $("error").hidden = true; $("dash").hidden = false;
    $("app").classList.add("is-loading");
    $("updated").hidden = false; $("updated").classList.add("busy");
    $("updated-text").textContent = "Loading from Google Sheets";
    setStatus("");
    sheetsGet().then(function (res) {
      if (seq !== loadSeq || !token) return;
      var vr = res.data.valueRanges || [];
      allTx = [];
      res.years.forEach(function (y, i) {
        MSL.parse((vr[i] && vr[i].values) || []).forEach(function (t) { t.id += i * 1000000; allTx.push(t); });
      });
      var meta = {};
      ((vr[res.years.length] && vr[res.years.length].values) || []).forEach(function (r) { meta[r[0]] = r[1]; });
      var d = meta.Updated ? new Date(meta.Updated) : null;
      $("updated-text").textContent = d && !isNaN(d) ? "Data updated " + d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Connected";
      $("updated").classList.remove("busy");
      $("app").classList.remove("is-loading");
      buildYears();
      render();
    }).catch(function (e) {
      if (seq !== loadSeq || !token) return;
      if (e && e.message === "expired") return;
      showError((e && e.message) || "Could not load the data.");
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
      b.addEventListener("click", function () { state.year = y; state.month = null; state.page = 0; render(); });
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
    if (!recent.length) {
      var p = document.createElement("li"); p.className = "empty";
      p.textContent = "No transactions in this view. Try All time, or tick Include planned.";
      ul.appendChild(p); return;
    }
    var frag = document.createDocumentFragment();
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
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  // looping ticker of the newest transactions; the list is doubled for a seamless loop
  function renderStream(scoped) {
    var track = $("stream");
    track.replaceChildren();
    var items = MSL.sortRows(scoped, "date", "desc").slice(0, 14);
    if (!items.length) { track.parentNode.hidden = true; return; }
    track.parentNode.hidden = false;
    function chips(hidden) {
      var frag = document.createDocumentFragment();
      items.forEach(function (t) {
        var isIn = t.inAmt > 0 && t.outAmt === 0;
        var c = document.createElement("span"); c.className = "sc " + (isIn ? "in" : "out");
        if (hidden) c.setAttribute("aria-hidden", "true");
        c.appendChild(document.createElement("i"));
        var n = document.createElement("span"); n.textContent = t.party || t.desc || "(no name)";
        var a = document.createElement("b"); a.textContent = (isIn ? "+" : "-") + MSL.fmtMoney(isIn ? t.inAmt : t.outAmt, 0);
        c.appendChild(n); c.appendChild(a);
        frag.appendChild(c);
      });
      return frag;
    }
    track.appendChild(chips(false)); track.appendChild(chips(true));
  }

  function pickMonth(key) {
    state.month = state.month === key ? null : key;
    state.page = 0;
    drawMonthly(false);
    renderTable();
    if (state.month) $("tx-card").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  var lastMonths = [];
  function drawMonthly(animate) {
    Charts.groupedBars($("ch-monthly"), lastMonths.map(function (m) { return { key: m.month, label: m.label, a: m.inn, b: m.out }; }), {
      label: "Money in and money out per month. Select a month to filter the table.", aName: "In", bName: "Out",
      fmt: MSL.fmtShort, fmtFull: money, onPick: pickMonth, selected: state.month, animate: animate
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

    setStatus(scoped.length ? scoped.length + " transactions in this view" : "");

    lastMonths = MSL.monthly(scoped);
    drawMonthly(true);
    renderRecent(scoped);
    renderStream(scoped);
    Charts.line($("ch-balance"), series, {
      label: "Account balance over time", fmt: MSL.fmtShort, fmtFull: money,
      dateLabel: function (iso) { return MSL.monthLabel(iso.slice(0, 7)); }
    });
    Charts.hbars($("top-in"), MSL.topParties(scoped, "inAmt", 8), { fmt: money, cls: "fill-a" });
    Charts.hbars($("top-out"), MSL.topParties(scoped, "outAmt", 8), { fmt: money, cls: "fill-b" });

    var G = MSL.moreganic(scoped);
    tween($("m-count"), G.count, function (v) { return String(Math.round(v)); });
    tween($("m-total"), G.total, money);
    tween($("m-avg"), G.avg, money);
    tween($("m-max"), G.max, money);
    $("m-last").textContent = G.last || "-";
    $("m-share").textContent = G.share === null ? "-" : G.share.toFixed(1) + "%";
    Charts.bars($("ch-mg"), lastMonths.map(function (m) { return { label: m.label, v: m.mg }; }), {
      label: "Amount paid to Moreganic per month", cls: "bar-b", name: "Paid to Moreganic",
      fmt: MSL.fmtShort, fmtFull: money
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
    var list = MSL.filter(allTx, { year: state.year, month: state.month, planned: state.planned, q: state.q });
    list = MSL.sortRows(list, state.sort, state.dir);
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    $("month-chip").hidden = !state.month;
    if (state.month) $("month-chip-text").textContent = "Showing " + MSL.monthLabel(state.month);

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
    if (!slice.length) {
      var er = tb.insertRow(), ec = er.insertCell();
      ec.colSpan = COLS.length; ec.className = "empty"; ec.textContent = "No transactions match. Clear the search or the month filter to see more.";
    }
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
  $("retry").addEventListener("click", load);
  $("planned").addEventListener("change", function (e) { state.planned = e.target.checked; state.page = 0; render(); });
  $("month-chip").addEventListener("click", function () { state.month = null; state.page = 0; drawMonthly(false); renderTable(); });
  var qTimer = null;
  $("q").addEventListener("input", function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = e.target.value; state.page = 0; renderTable(); }, 160);
  });
  $("prev").addEventListener("click", function () { state.page--; renderTable(); });
  $("next").addEventListener("click", function () { state.page++; renderTable(); });

  setupReveal();
  if (!configured()) setLoginMsg("This site is not set up yet. Fill in docs/config.js with the Client ID and the Sheet ID.");
  else initGoogle();
})();
