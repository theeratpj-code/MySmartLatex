# My Smart Latex

Static site on GitHub Pages (`docs/`) with Google sign-in. It reads two Excel files from a Synology NAS through a small API (`nas-api/`) that runs on the NAS.

```
Browser (GitHub Pages) --Google ID token--> NAS API (HTTPS) --local disk--> .xlsx
```

The API runs on the NAS, so it reads the files directly and needs no DSM login. Only Google accounts listed in `ALLOWED_EMAILS` get data.

## 1. Google OAuth Client ID
1. https://console.cloud.google.com → create a project.
2. APIs & Services → OAuth consent screen → External → app name, your email. Leave it in **Testing** and add `theerat.pp@gmail.com` under **Test users**.
3. Credentials → Create credentials → OAuth client ID → **Web application**.
4. Authorized JavaScript origins: `https://theeratpj-code.github.io`
5. Copy the Client ID into `docs/config.js` and into `nas-api/.env`.

## 2. HTTPS address for the NAS
QuickConnect (`*.quickconnect.to`) cannot front a custom API. Use:
- DSM → Control Panel → External Access → DDNS: add a `yourname.synology.me` hostname.
- Control Panel → Security → Certificate: request a Let's Encrypt certificate for it.
- Router: forward TCP 443 to the NAS.
- Control Panel → Login Portal → Advanced → Reverse Proxy → Create:
  source HTTPS `yourname.synology.me` port 443 → destination HTTP `localhost` port 3000.
  Use a path-restricted setup or a dedicated hostname if you also serve DSM on 443.
- Put the address in `docs/config.js` as `API_URL`.

## 3. Run the API on the NAS
**With Docker (Container Manager):**
1. Copy `nas-api/` to the NAS, e.g. `/volume1/docker/mysmartlatex-api`.
2. `cp .env.example .env` and fill in the Client ID.
3. Container Manager → Project → Create → point at that folder (it uses `docker-compose.yml`). The Excel folder is mounted read-only.

**Without Docker:** install Node.js from Package Center, then in that folder run `npm install`, set the variables from `.env.example` (with the real `DATA_DIR`), and run `node server.js` from DSM Task Scheduler as a boot-up task.

Check: `https://yourname.synology.me/health` returns `{"ok":true}`.

## 4. GitHub Pages
Repo → Settings → Pages → Deploy from branch → `main` → folder `/docs`.
Site: https://theeratpj-code.github.io/MySmartLatex/

## Security notes
- Excel files and `.env` are git-ignored; never commit them.
- Google ID tokens last about 1 hour; the page asks you to sign in again after that.
- The API only answers CORS requests from `ALLOWED_ORIGIN`, and checks the token on every request.
