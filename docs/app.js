(function () {
  const { GOOGLE_CLIENT_ID, API_URL } = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  let token = null;
  let sheets = [];

  function setStatus(msg) { $("status").textContent = msg || ""; }

  async function api(pathAndQuery) {
    const res = await fetch(API_URL + pathAndQuery, {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) { signOut(); throw new Error("Session expired, please sign in again."); }
    if (res.status === 403) { signOut(); throw new Error("This Google account is not allowed."); }
    if (!res.ok) throw new Error("Server error (" + res.status + ")");
    return res.json();
  }

  function decodeEmail(jwt) {
    try {
      const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64)).email || "";
    } catch { return ""; }
  }

  function fillSelect(el, values) {
    el.replaceChildren(...values.map((v, i) => new Option(v, v)));
  }

  function renderTable() {
    const sheet = sheets.find((s) => s.name === $("sheet").value);
    const table = $("table");
    table.replaceChildren();
    if (!sheet || sheet.rows.length === 0) { setStatus("No data in this sheet."); return; }
    const q = $("filter").value.trim().toLowerCase();
    const [head, ...body] = sheet.rows;
    const rows = q ? body.filter((r) => r.some((c) => String(c).toLowerCase().includes(q))) : body;

    const thead = table.createTHead().insertRow();
    head.forEach((c) => { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); });
    const tbody = table.createTBody();
    rows.forEach((r) => {
      const tr = tbody.insertRow();
      head.forEach((_, i) => {
        const td = tr.insertCell();
        const v = r[i] === undefined ? "" : r[i];
        td.textContent = v;
        if (typeof v === "number") td.className = "num";
      });
    });
    setStatus(rows.length + " of " + body.length + " rows");
  }

  async function loadYear() {
    setStatus("Loading…");
    try {
      const data = await api("/api/data?file=" + encodeURIComponent($("year").value));
      sheets = data.sheets;
      fillSelect($("sheet"), sheets.map((s) => s.name));
      renderTable();
    } catch (e) { setStatus(e.message); }
  }

  async function onCredential(resp) {
    token = resp.credential;
    $("email").textContent = decodeEmail(token);
    $("login").hidden = true;
    $("user").hidden = false;
    $("app").hidden = false;
    try {
      const { files } = await api("/api/files");
      fillSelect($("year"), files);
      await loadYear();
    } catch (e) { setStatus(e.message); }
  }

  function signOut() {
    token = null; sheets = [];
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    $("app").hidden = true; $("user").hidden = true; $("login").hidden = false;
    $("table").replaceChildren();
  }

  function init() {
    if (!window.google || !google.accounts) { setTimeout(init, 100); return; }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
    google.accounts.id.renderButton($("g-button"), { theme: "outline", size: "large" });
  }

  $("year").addEventListener("change", loadYear);
  $("sheet").addEventListener("change", renderTable);
  $("filter").addEventListener("input", renderTable);
  $("signout").addEventListener("click", signOut);
  init();
})();
