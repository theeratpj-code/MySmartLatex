# My Smart Latex

Static site on GitHub Pages (`docs/`). After Google sign-in it reads two private Excel files from the owner's Google Drive (read-only) and shows them as tables. There is no server and no stored data.

Open `setup-guide.html` locally for the step-by-step setup.

## Security design
- Data lives only in Google Drive; the repo holds code only (`*.xlsx` and `.env` are git-ignored).
- OAuth app stays in **Testing** mode with one test user, files stay **Restricted** (never "anyone with the link").
- Scope `drive.readonly`; the access token is kept in memory only, revoked on sign-out, and the page signs out after `IDLE_MINUTES` of inactivity.
- Content-Security-Policy meta tag limits network access to Google; no inline scripts; SheetJS 0.20.3 is vendored in `docs/vendor/`.
- Cells are rendered with `textContent`; only files owned by the signed-in account are opened.
- Protect the GitHub account (2FA) and the `main` branch: anyone who can change `docs/app.js` can steal the token.

## Config
Edit `docs/config.js`: Client ID, and the Drive file IDs for 2025 and 2026.
