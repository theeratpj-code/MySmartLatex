// MySmartLatex NAS API
// Verifies a Google ID token, checks the email allowlist, reads the bank
// transaction .xlsx files from local disk and returns them as JSON.
const http = require("http");
const path = require("path");
const fs = require("fs");
const { OAuth2Client } = require("google-auth-library");
const ExcelJS = require("exceljs");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://theeratpj-code.github.io";
const DATA_DIR = process.env.DATA_DIR || "/data";
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// key shown in the web app -> exact file name inside DATA_DIR
const FILES = {
  "2025": "My Smart Bank transaction 2025  OK.xlsx",
  "2026": "My Smart Bank transaction 2026.xlsx",
};

if (!CLIENT_ID || ALLOWED_EMAILS.length === 0) {
  console.error("GOOGLE_CLIENT_ID and ALLOWED_EMAILS must be set");
  process.exit(1);
}

const oauth = new OAuth2Client(CLIENT_ID);

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  });
  res.end(JSON.stringify(body));
}

async function authenticate(req) {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return { status: 401, error: "Missing token" };
  try {
    const ticket = await oauth.verifyIdToken({ idToken: m[1], audience: CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email || !p.email_verified) return { status: 403, error: "Email not verified" };
    if (!ALLOWED_EMAILS.includes(p.email.toLowerCase())) return { status: 403, error: "Not allowed" };
    return { email: p.email };
  } catch {
    return { status: 401, error: "Invalid token" };
  }
}

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result); // formula
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text); // hyperlink
    if ("error" in v) return String(v.error);
    return "";
  }
  return v;
}

async function readWorkbook(key) {
  const file = FILES[key];
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) throw Object.assign(new Error("File not found"), { status: 404 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(full);
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values.slice(1).map(cellValue); // row.values is 1-based
      rows.push(vals);
    });
    return { name: ws.name, rows };
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return send(res, 200, { ok: true });

  const auth = await authenticate(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });

  try {
    if (url.pathname === "/api/files") return send(res, 200, { files: Object.keys(FILES) });
    if (url.pathname === "/api/data") {
      const key = url.searchParams.get("file");
      if (!Object.prototype.hasOwnProperty.call(FILES, key)) return send(res, 400, { error: "Unknown file" });
      return send(res, 200, { file: key, sheets: await readWorkbook(key) });
    }
    return send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
  }
});

server.listen(PORT, () => console.log(`MySmartLatex API on :${PORT}`));
