# My Smart Latex: KBank dashboard

Static dashboard on GitHub Pages (`docs/`). After Google sign-in it reads one private Google Sheet (read-only) and shows money in/out, balances, top payers/payees, latex purchases and the transaction list. There is no server and nothing is stored in the browser.

Data flow: local Python uploader -> Apps Script web app (checks a secret) -> private Google Sheet (one tab per year) -> this page.

## Security design
- Data lives only in the Google Sheet. The repo holds code only; the uploader, its secret and the setup guide are not published.
- Uploads need a long secret kept in the Apps Script's Script properties; wrong secret writes nothing.
- Google OAuth app stays in **Testing** mode with one test user; the sheet stays private to its owner.
- Web scope is `spreadsheets.readonly`. The access token is kept in memory only, revoked on sign-out, and the page signs out after `IDLE_MINUTES` of inactivity.
- Content-Security-Policy limits network access to Google; no inline scripts; no third-party libraries.
- All text is inserted with `textContent`; sheet cells are written as raw text so formulas never run.
- Protect the GitHub account (2FA) and the `main` branch: anyone who can change `docs/app.js` can steal the token.

## Years and viewers
- The uploader finds `My Smart Bank transaction <year>*.xlsx` by pattern (no file names or years are hardcoded), reads only the `KBank` sheet, and sends one tab per year. By default only the latest year is uploaded.
- The page lists the sheet's year tabs (`2024`, `2025`, ...) itself, so a new year needs no code change.
- The sheet's `Viewers` tab lists emails that are shared on the sheet read-only by the Apps Script. Access is enforced by Google, not by the page.

## Config
`docs/config.js`: web Client ID and Sheet ID (neither is secret).
