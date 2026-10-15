(function () {
  "use strict";

  // Refuse to run inside someone else's page (clickjacking).
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    return;
  }

  var cfg = window.APP_CONFIG || {};
  var SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  var DRIVE = "https://www.googleapis.com/drive/v3/files/";
  var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var GSHEET_MIME = "application/vnd.google-apps.spreadsheet";
  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_ROWS_SHOWN = 2000;

  var $ = function (id) { return document.getElementById(id); };
  var token = null;        // kept in memory only, never written to storage
  var tokenClient = null;
  var idleTimer = null;
  var sheets = [];
  var loadSeq = 0;

  function configured() {
    return cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_ID.indexOf("PASTE_") === -1 &&
      Array.isArray(cfg.FILES) && cfg.FILES.length > 0 &&
      cfg.FILES.every(function (f) { return f.id && f.id.indexOf("PASTE_") === -1 && /^[A-Za-z0-9_-]{10,}$/.test(f.id); });
  }

  function setStatus(msg) { $("status").textContent = msg || ""; }
  function setLoginMsg(msg) { $("login-msg").textContent = msg || ""; }

  // ---- idle sign-out -------------------------------------------------------
  function resetIdle() {
    if (!token) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { signOut("Signed out after inactivity."); }, (cfg.IDLE_MINUTES || 15) * 60 * 1000);
  }
  ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, resetIdle, { passive: true });
  });

  // ---- sign in / out -------------------------------------------------------
  function signOut(msg) {
    var t = token;
    token = null;
    sheets = [];
    loadSeq++;
    clearTimeout(idleTimer);
    $("table").replaceChildren();
    $("filter").value = "";
    $("app").hidden = true;
    $("signout").hidden = true;
    $("login").hidden = false;
    setStatus("");
    setLoginMsg(msg || "");
    if (t && window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(t, function () {});
    }
  }

  function onToken(resp) {
    if (!resp || resp.error) {
      setLoginMsg("Sign-in was cancelled or refused.");
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      setLoginMsg("Please allow read-only access to Google Drive to continue.");
      return;
    }
    token = resp.access_token;
    $("login").hidden = true;
    $("app").hidden = false;
    $("signout").hidden = false;
    setLoginMsg("");
    resetIdle();
    fillSelect($("year"), cfg.FILES.map(function (f) { return f.label; }));
    loadYear();
  }

  function initGoogle() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) { setTimeout(initGoogle, 100); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: cfg.LOGIN_HINT || undefined,
      callback: onToken,
      error_callback: function () { setLoginMsg("The Google sign-in window was closed or blocked."); },
    });
    $("signin").disabled = false;
  }

  // ---- Drive ---------------------------------------------------------------
  function driveGet(url) {
    return fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", referrerPolicy: "no-referrer" })
      .then(function (res) {
        if (res.status === 401) { signOut("Your session expired. Please sign in again."); throw new Error("expired"); }
        if (res.status === 403) throw new Error("Google refused access. Check that the Drive API is enabled and the file is yours.");
        if (res.status === 404) throw new Error("File not found in Drive. Check the file ID in config.js.");
        if (!res.ok) throw new Error("Google Drive error (" + res.status + ").");
        return res;
      });
  }

  function fetchWorkbook(fileId) {
    var metaUrl = DRIVE + encodeURIComponent(fileId) + "?fields=name,mimeType,size,trashed,ownedByMe";
    return driveGet(metaUrl).then(function (r) { return r.json(); }).then(function (meta) {
      if (meta.trashed) throw new Error("That file is in the Drive bin.");
      if (!meta.ownedByMe) throw new Error("That file is not owned by your Google account, so it was not opened.");
      if (meta.size && Number(meta.size) > MAX_BYTES) throw new Error("That file is too large.");
      var url;
      if (meta.mimeType === GSHEET_MIME) {
        url = DRIVE + encodeURIComponent(fileId) + "/export?mimeType=" + encodeURIComponent(XLSX_MIME);
      } else if (meta.mimeType === XLSX_MIME) {
        url = DRIVE + encodeURIComponent(fileId) + "?alt=media";
      } else {
        throw new Error("That file is not an Excel or Google Sheets file.");
      }
      return driveGet(url).then(function (r) { return r.arrayBuffer(); });
    }).then(function (buf) {
      if (buf.byteLength > MAX_BYTES) throw new Error("That file is too large.");
      var wb = XLSX.read(buf, { type: "array" });
      return wb.SheetNames.map(function (name) {
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
        return { name: name, rows: rows };
      });
    });
  }

  // ---- UI ------------------------------------------------------------------
  function fillSelect(el, values) {
    el.replaceChildren.apply(el, values.map(function (v) { return new Option(v, v); }));
  }

  var NUMERIC = /^[-+(]?[\d.,\s]+\)?%?$/;

  function renderTable() {
    var table = $("table");
    table.replaceChildren();
    var sheet = sheets.filter(function (s) { return s.name === $("sheet").value; })[0];
    if (!sheet || sheet.rows.length === 0) { setStatus("No data in this sheet."); return; }
    var head = sheet.rows[0];
    var body = sheet.rows.slice(1);
    var q = $("filter").value.trim().toLowerCase();
    var rows = q ? body.filter(function (r) { return r.some(function (c) { return String(c).toLowerCase().indexOf(q) !== -1; }); }) : body;
    var shown = rows.slice(0, MAX_ROWS_SHOWN);

    var hr = table.createTHead().insertRow();
    head.forEach(function (c) { var th = document.createElement("th"); th.textContent = c; hr.appendChild(th); });
    var tb = table.createTBody();
    shown.forEach(function (r) {
      var tr = tb.insertRow();
      for (var i = 0; i < head.length; i++) {
        var td = tr.insertCell();
        var v = r[i] === undefined ? "" : String(r[i]);
        td.textContent = v;
        if (v && NUMERIC.test(v)) td.className = "num";
      }
    });
    setStatus(shown.length + " of " + body.length + " rows" +
      (rows.length > shown.length ? " (first " + MAX_ROWS_SHOWN + " of " + rows.length + " matches; narrow with the filter)" : ""));
  }

  function loadYear() {
    var entry = cfg.FILES.filter(function (f) { return f.label === $("year").value; })[0];
    if (!entry) return;
    var seq = ++loadSeq;
    setStatus("Loading from Google Drive...");
    $("table").replaceChildren();
    fetchWorkbook(entry.id).then(function (result) {
      if (seq !== loadSeq || !token) return;
      sheets = result;
      fillSelect($("sheet"), sheets.map(function (s) { return s.name; }));
      renderTable();
    }).catch(function (e) {
      if (seq !== loadSeq || !token) return;
      setStatus(e && e.message === "expired" ? "" : (e && e.message) || "Could not load the file.");
    });
  }

  $("signin").addEventListener("click", function () {
    setLoginMsg("");
    if (tokenClient) tokenClient.requestAccessToken();
  });
  $("signout").addEventListener("click", function () { signOut("You have signed out."); });
  $("year").addEventListener("change", loadYear);
  $("sheet").addEventListener("change", renderTable);
  $("filter").addEventListener("input", renderTable);

  if (!configured()) {
    setLoginMsg("This site is not set up yet. Fill in docs/config.js with your Client ID and the two Drive file IDs.");
  } else {
    initGoogle();
  }
})();
