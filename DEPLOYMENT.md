# Ami for Nextcloud Talk — Deployment Guide

Complete deployment documentation for the Ami Help Desk bot on Nextcloud Talk:
the Nextcloud/Talk side, the bot container, production deploy on the same host,
development deploys behind an ngrok tunnel, troubleshooting, and maintenance.

> Quick-start lives in [README.md](README.md). This document is the full reference.
> Everything here was verified against **stock Nextcloud (`nextcloud:stable`) + Postgres + Talk HPB** running on Docker Desktop for Windows 11.

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Prerequisites](#2-prerequisites)
3. [Nextcloud Talk setup](#3-nextcloud-talk-setup)
4. [Bot deployment — production (container on stock network)](#4-bot-deployment--production-container-on-stock-network)
5. [Development deploy behind ngrok](#5-development-deploy-behind-ngrok)
6. [Troubleshooting](#6-troubleshooting)
7. [Maintenance](#7-maintenance)

---

## 1. Architecture

```
┌───────────────────────────── Docker host ──────────────────────────────┐
│                                                                        │
│  ┌─────────────────── nextcloud network ───────────────────────┐   │
│  │                                                                 │   │
│  │  ┌────────────────┐   webhook (HMAC-signed)   ┌──────────────┐  │   │
│  │  │ nextcloud      │ ─────────────────────────► │ ami-talk-bot │  │   │
│  │  │ nextcloud      │   POST http://ami-talk-    │ (Node/TS     │  │   │
│  │  │ (Talk app)     │◄────────────────────────── │  Express)    │  │   │
│  │  └────────────────┘   signed OCS reply         └──────┬───────┘  │   │
│  │                                                        │          │   │
│  └────────────────────────────────────────────────────────┼──────────┘   │
│                                                           │ HTTPS        │
│                                                    ┌──────▼───────┐      │
│                                                    │ Gemini /     │      │
│                                                    │ OpenAI /     │      │
│                                                    │ Azure OpenAI │      │
│                                                    └──────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
```

**The loop**

1. A user posts a message in a Talk room where Ami is enabled.
2. Talk immediately POSTs a signed webhook to the bot URL (`ami-talk-bot:3979/api/talk/webhook`).
3. The bot verifies the signature, parses the Activity Streams 2.0 payload, and calls the AI.
4. The bot posts its reply back to Talk's bot API, signed with the shared secret.

**Protocol facts you must know when debugging**

| Direction | Signing rule |
|---|---|
| Talk → bot (webhook) | `X-Nextcloud-Talk-Signature` = HMAC-SHA256( `X-Nextcloud-Talk-Random` + **raw body**, secret ) |
| Bot → Talk (reply) | `X-Nextcloud-Talk-Bot-Signature` = HMAC-SHA256( `X-Nextcloud-Talk-Bot-Random` + **message text only**, secret ) |

- Webhook payloads use the **Activity Streams 2.0** vocabulary: `{type, actor, object, target}`.
  - `type: "Create"` = new chat message (`"Join"`/`"Leave"` = bot added/removed, `"Like"`/`"Undo"` = reactions).
  - `object.name === "message"` for regular chat messages; anything else is a system message.
  - `object.content` is a JSON-encoded string: `{"message": "...", "parameters": {...}}`.
  - `target.id` is the room token.
- Official protocol docs: <https://nextcloud-talk.readthedocs.io/en/latest/bots/>

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| Nextcloud | Any instance with the **Talk** app enabled. Webhook bots need capability `bots-v1` (Nextcloud 27.1+ / Talk 17.1+). |
| occ access | Ability to run `docker exec -u www-data nextcloud php occ ...` (or shell access to your Nextcloud). |
| Moderator rights | Enabling a bot in a room requires the room owner/moderator (UI) or their credentials (API). |
| Docker + Compose | For containerized deployment of the bot. Node.js 22 works too if you prefer bare-metal. |
| AI API key | One of: `GEMINI_API_KEY`, `OPENAI_API_KEY`, or Azure OpenAI endpoint + key + deployment. No key = bot runs but answers with a "no AI configured" notice. |
| Network reachability | The **Nextcloud container must be able to reach the bot URL**, and the **bot must be able to reach Nextcloud over HTTPS**. On the same Docker host this is handled by joining the `nextcloud-net` network (bot side) and publishing port 443 (Nextcloud side). |

Optional but recommended:

| Requirement | Details |
|---|---|
| ngrok account + authtoken | Only needed for the development-tunnel deployments in section 5. Free tier is sufficient for testing. |

> **AppAPI note:** AppAPI (`app_api`) ships installed-but-disabled in some images. It is **not required** for webhook bots — it only matters for ExApps (external Nextcloud apps). Enable it if your Admin panel complains or if you plan to install ExApps: `occ app:enable app_api`.

---

## 3. Nextcloud Talk setup

Skip any step that is already done on your instance.

### 3.1 Verify Talk is healthy

```bash
# Stock: the Talk high-performance backend container should be up and healthy
docker ps --filter name=nextcloud     talk --format "{{.Names}}: {{.Status}}"

# Confirm the spreed (Talk) app version and that it is enabled
docker exec nextcloud php occ config:app:get spreed installed_version
docker exec nextcloud php occ config:app:get spreed enabled   # → "yes"
```

### 3.2 Create a conversation for the bot

**Option A — Talk UI:** create a group conversation normally and note its token
(the short code in the URL/federation link, e.g. `kntczu8k`).

**Option B — occ:**

```bash
docker exec -u www-data nextcloud php occ talk:room:create "Ami Help Desk" --user admin --user test1
```

If the users end up as plain participants instead of moderators (needed to manage bots), promote them:

```bash
docker exec nextcloud php occ talk:room:promote kntczu8k admin test1
```

### 3.3 Understand bot feature flags

Bots are registered with one or more feature flags — **these decide everything**:

| Flag | Bit | Meaning |
|---|---|---|
| `webhook` | 1 | Bot receives **webhooks** for every message in rooms where it is enabled |
| `response` | 2 | Bot may **post messages** back into the room |
| `event` | 4 | In-process PHP events (only relevant for Nextcloud apps acting as bots) |

⚠️ **A help desk bot needs BOTH `webhook` and `response`.**
Registering with only `response` produces a bot that can reply but never hears anyone — Talk silently skips dispatching webhooks (`features & FEATURE_WEBHOOK = 0`). This is the #1 cause of a "silent bot".

**Image handling notes** (how Ami reads shared pictures):

- File shares arrive as webhooks with `type: "Activity"` (not `"Create"`), `object.name: "message"`, and the file details in `object.content` → `parameters.file` (name, mimetype, size, path, link).
- Download strategy: public share link (`/s/<token>/download`) when present; otherwise **WebDAV fallback** using `TALK_ADMIN_USER` (room shares mount flat under `<admin>/Talk/<filename>`).
- Images are analyzed **only when the share mentions ami**; the reply is posted **in-thread** (`replyTo`) to the share message.

### 3.4 Register the bot (server side)

Generate a secret yourself — **40 to 128 characters** (occ rejects shorter; keep it hex for URL safety):

```bash
# 20 random bytes = 40 hex chars
openssl rand -hex 20            # Linux/macOS
# PowerShell:
$bytes = New-Object byte[] 20; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
```

Register (choose the URL matching your deployment — see section 4 or 5):

```bash
docker exec -u www-data nextcloud php occ talk:bot:install \
    Ami \
    <SECRET> \
    http://ami-talk-bot:3979/api/talk/webhook \
    "Ami Help Desk assistant" \
    --feature webhook --feature response
# → Bot installed, ID: N   (note the ID)
```

Manage registrations:

```bash
docker exec nextcloud php occ talk:bot:list        # shows ID, state, features, error_count
docker exec nextcloud php occ talk:bot:uninstall <id>
```

`error_count` in `talk:bot:list` increments when Talk delivers a webhook and gets an unexpected HTTP status back — `0` with a silent bot means **delivery never happened** (usually the feature-flag trap above), while a growing count points at the bot being down or replying non-2xx.

You can also sanity-check the route exists on your Talk version (should print the `ocs.spreed.bot.sendmessage` table):

```bash
docker exec nextcloud php occ router:match --method POST "/ocs/v2.php/apps/spreed/api/v1/bot/abcdef123456/message"
```

### 3.5 Enable the bot per conversation

Registration alone does nothing — bots are opt-in **per room**.

**Option A — Talk UI (as room moderator):**
open the conversation → ⚙ conversation settings → **Bots** → toggle **Ami** on.

**Option B — API (as moderator, e.g. basic auth):**

```
POST /ocs/v2.php/apps/spreed/api/v1/bot/{ROOM_TOKEN}/{BOT_ID}
Headers: OCS-APIRequest: true
→ 201 Created (200 = already enabled)
```

⚠️ Note the API version: `/api/v1/...`, **not** `/api/v4/...` — the bot-management routes moved around between Talk versions; check `occ router:list spreed | grep bot` if unsure.

Notes:

- Disabling/removing later: same endpoints with `DELETE`, or just toggle off in the UI.
- Bots do **not** appear as normal participants in the attendee list — they live under conversation settings → Bots. That is expected.

---

## 4. Bot deployment — production (container on stock network)

This is the proven setup: the bot runs as a Docker container attached to the stock Nextcloud Docker network, so Nextcloud reaches it by container name and no ports are exposed publicly.

### 4.1 Configure environment

Create `env/.env.dev.user` (git-ignored) from `.env.example` and fill in:

| Variable | Required | Example / notes |
|---|---|---|
| `TALK_SERVER_URL` | ✅ | `https://nextcloud.example.com` — base URL, no trailing slash |
| `SECRET_TALK_SECRET` | ✅ | The exact secret used in `talk:bot:install` |
| `SECRET_GEMINI_API_KEY` *or* `SECRET_OPENAI_API_KEY` *or* `AZURE_OPENAI_*` | ✅ | Pick one provider; `AI_PROVIDER=auto` detects which |
| `PORT` | – | Defaults to `3979` |
| `COMPANY_NAME` | – | Shown in greetings/help |
| `TALK_REQUIRE_MENTION` | – | `true` = only answer when the word **ami** is mentioned (the `@` is optional); default `true` |
| `TALK_ADMIN_USER` / `SECRET_TALK_ADMIN_PASSWORD` | – | Nextcloud user for the **image-download WebDAV fallback**; must be a member of the room. Leave empty to rely on public share links only |
| `MAX_IMAGE_SIZE_MB` | – | Max image size Ami downloads & analyzes (default `10`). Images **always** require an **ami** mention regardless of `TALK_REQUIRE_MENTION` |
| `SENSITIVE_TOPICS` | – | Extra blocked phrases, comma-separated |
| `SESSION_TIMEOUT`, `MAX_HISTORY_TURNS`, `RATE_LIMIT_WINDOW`, `MAX_REQUESTS_PER_WINDOW` | – | Conversation tuning; see `.env.example` |

### 4.2 Build and run

`docker-compose.yml` (already in this repo) attaches the bot to the stock network:

```yaml
services:
  ami-talk-bot:
    build: .
    container_name: ami-talk-bot
    restart: unless-stopped
    networks:
      - nextcloud-net
    env_file: env/.env.dev.user

networks:
  nextcloud-net:
    external: true
```

```bash
docker compose up -d --build

# verify
curl http://localhost:3979/api/health        # → {"status":"healthy","talkConfigured":true,...}
docker logs ami-talk-bot --tail 20
```

Because the container joins the `nextcloud-net` network, Nextcloud reaches it at
`http://ami-talk-bot:3979` — this exact URL is what you pass to `talk:bot:install`
(section 3.4). No public port exposure needed.

Verify reachability from Nextcloud's perspective:

```bash
docker exec nextcloud curl -s -o /dev/null -w "%{http_code}\n" http://ami-talk-bot:3979/api/health
# → 200
```

### 4.3 Go live checklist

1. `env/.env.dev.user` filled in (section 4.1)
2. `docker compose up -d --build` succeeded, health OK
3. Bot registered **with `--feature webhook --feature response`** (section 3.4)
4. Bot enabled in the room (section 3.5)
5. Post any message in the room → `docker logs ami-talk-bot` shows `📨 Room ... | user: "..."` then `📤 Reply posted`

---

## 5. Development deploy behind ngrok

Two scenarios. Both reuse the same bot code and the same registration mechanics — only the **bot URL registered in Talk** changes.

### 5.1 Scenario B1 — remote Nextcloud → local bot (ngrok tunnel to your dev machine)

Use this when Nextcloud runs elsewhere (VPS, company server) but you want to develop/test the bot on your own PC without deploying it.

**Step 1 — run the bot locally (no Docker networking needed):**

```bash
npm install && npm run dev        # listens on http://localhost:3979
```

**Step 2 — expose it with ngrok:**

```bash
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>   # once
ngrok http 3979
```

Note the forwarding URL, e.g. `https://unmoving-ogle-survival.ngrok-free.dev`.

**Step 3 — register that URL as the bot:**

```bash
docker exec -u www-data nextcloud php occ talk:bot:install \
    AmiDev <SECRET> \
    https://unmoving-ogle-survival.ngrok-free.dev/api/talk/webhook \
    "Ami Help Desk assistant" \
    --feature webhook --feature response
```

Then enable it in a room (section 3.5) and chat — every message now travels
Talk → ngrok edge → your PC.

**Free-tier caveats:**

- The URL **changes every time ngrok restarts** → re-run `talk:bot:install` with the new URL (or use a static domain: dashboard.ngrok.com → Domains, then `ngrok http 3979 --domain=your-name.ngrok-free.dev`).
- ngrok free may serve an interstitial "Visit Site" page to browser-like requests. Server-to-server POSTs from Talk are unaffected, but if you test the webhook manually with curl add `-H "ngrok-skip-browser-warning: true"`.
- Added latency (traffic hairpins through ngrok's edge); fine for development, not for production.

**Switching back:** uninstall the dev bot (`occ talk:bot:uninstall <id>`), re-enable the production one.

### 5.2 Scenario B2 — tunneling the whole local stack with ngrok

Use this when **everything runs locally** (Nextcloud on your PC behind a corporate network with no open ports) and you want to reach Nextcloud itself from outside. This mirrors the working setup from the AIO session.

Add an ngrok service to the **stock compose.yaml** (the one containing `nextcloud`):

```yaml
  ngrok:
    image: ngrok/ngrok:latest
    command: http --host-header=localhost:8080 https://host.docker.internal:8080
    restart: unless-stopped
    ports:
      - "4040:4040"                     # ngrok inspection dashboard
    environment:
      - NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN}
```

Hard-won details baked into that command:

- **`https://host.docker.internal:8080`** — the Nextcloud app on 8080 is HTTPS-only. Plain `http 8080` fails with *"Client sent an HTTP request to an HTTPS server"*; upstream TLS verification is off by default so the self-signed cert is fine.
- **`--host-header=localhost:8080`** — the AIO interface validates the Host header against its configured URL; rewriting keeps it happy.
- Put `NGROK_AUTHTOKEN=...` in a `.env` next to that compose file — env vars set in your shell are **not** reliably picked up by Compose on Windows.

Find your current tunnel URL and test through it:

```powershell
Invoke-RestMethod http://localhost:4040/api/tunnels            # current public_url
curl.exe -sk -H "ngrok-skip-browser-warning: true" -L -o NUL -w "%{http_code}`n" https://<your-tunnel>.ngrok-free.dev
```

**Bot placement in this scenario:** keep using the section-4 containerized bot —
both Nextcloud and the bot stay local, so the bot URL remains
`http://ami-talk-bot:3979/api/talk/webhook`. ngrok here only exposes the
*interfaces*, not the bot. If you additionally want remote users to chat with
Ami through the tunnel, also tunnel port 443 (Caddy) and remember Talk's webhooks
stay internal regardless.

> 📦 The ready-made ngrok compose block used in our deployment lives in the companion repo
> [`nextcloud     customs`](https://github.com/miel-R/nextcloud     customs).

---

## 6. Troubleshooting

Symptom-driven matrix. Every row was actually hit and confirmed during deployment.

| Symptom | Root cause | Fix |
|---|---|---|
| Bot registered & enabled but **never receives anything**; `error_count` stays 0; nothing in bot logs | Registered **without `--feature webhook`** — Talk filters it out before delivery | Reinstall with `--feature webhook --feature response` (section 3.3/3.4) |
| Webhook arrives, AI responds, but reply fails with **401** | Signed the wrong data — the reply signature covers `random + message text`, **not** the JSON body | Fixed in `src/services/talk/talk-client.service.ts`; sign the message string only |
| Reply fails with **404 / OCS statuscode 998** | Old-style URL `/bot/{SECRET}/message`; Talk ≥17 wants `/bot/{ROOM_TOKEN}/message`. Also: URL-path segments are limited to `[a-z0-9]{4,30}` — a >30-char secret in the URL never matches a route | Use the room token in the path; keep the secret out of URLs entirely (headers carry auth) |
| `occ talk:bot:install` rejects the secret | Must be **40–128 characters** | Generate 20+ random bytes hex (`openssl rand -hex 20`) |
| `POST /ocs/.../bots/{id}` returns 404 when enabling per-room | Wrong API version or missing moderator rights | Use `/api/v1/bot/{token}/{botId}`; promote the user first (`occ talk:room:promote`) |
| You get 404 even though the route looks right | Route requirements differ per Talk version | Check reality: `occ router:list spreed \| grep bot` and `occ router:match --method POST "/ocs/v2.php/apps/spreed/api/v1/bot/abc123/message"` |
| Bot replies but the message never appears in the room | Signature mismatch → Talk throttles/rejects silently after failures; watch for `error_count` spikes and 429 | Verify header names (`X-Nextcloud-Talk-Bot-Random/-Signature`), random ≥32 chars, lowercase-hex signature, exact secret match |
| Container logs show nothing at all after posting | Webhook never dispatched (see row 1) or bot unreachable | From inside Nextcloud: `curl http://<bot-host>:3979/api/health` — must return 200 |
| **Windows/Docker Desktop:** Nextcloud containers resolve your domain to `127.0.0.1` and connections fail instantly (cURL error 7) | Docker Desktop forwards container DNS through the Windows resolver, which honors the hosts file; a hosts entry like `127.0.0.1 cloud.example.com` leaks into every container | Point the hosts entry at the host's LAN IP instead of `127.0.0.1`, or remove it; no container restart needed (DNS is re-resolved) |
| Admin panel warns about AppAPI / ExApps unavailable | `app_api` installed but disabled (AIO default) | `occ app:enable app_api` — optional for webhook bots, required for ExApps |
| Bot worked, then stopped after a server change | Bot uninstalled/reinstalled → **new bot ID** → per-room enablement lost | Re-enable in each room after reinstalling (section 3.5) |
| ngrok tunnel dead after restart | Free-tier URLs rotate every restart | Grab new URL from `http://localhost:4040/api/tunnels` and update the bot registration, or claim a free static domain |

Diagnostic quick-reference:

```bash
# Is the bot registered, with which features? error_count?
docker exec nextcloud php occ talk:bot:list

# Is the bot linked to THIS room?
docker exec nextcloud     database psql -U nextcloud -d nextcloud_database \
    -c "SELECT * FROM oc_talk_bots_conversation WHERE token='<ROOM_TOKEN>';"

# Did Talk attempt delivery? (look for 'Bot' errors)
docker exec nextcloud sh -c 'grep -i bot /var/www/html/data/nextcloud.log | tail -5'

# What did the bot see?
docker logs ami-talk-bot --since 10m
```

---

## 7. Maintenance

| Task | How |
|---|---|
| Update bot code | `git pull` (if applicable) → `docker compose up -d --build` — brief downtime only for the bot, Talk queues nothing (best-effort delivery), so avoid chatting during rebuild |
| View bot logs | `docker logs ami-talk-bot --since 10m` (stdout+stderr both go to docker logs) |
| Disable bot in ONE room | Room settings → Bots → toggle off, or `DELETE /ocs/v2.php/apps/spreed/api/v1/bot/{token}/{botId}` |
| Remove bot entirely | `occ talk:bot:uninstall <id>` — removes it (and implicitly its room links) everywhere |
| Rotate the secret | Generate new secret → `occ talk:bot:uninstall <old-id>` → install again with the same URL + new secret → re-enable in rooms → update `SECRET_TALK_SECRET` → `docker compose restart ami-talk-bot` |
| Change the webhook path/port | Set `TALK_WEBHOOK_PATH` / `PORT`, rebuild, and re-register the bot URL to match |
| Add the bot to another room | Just enable it there (UI or API) — no re-registration needed |
| Move to a different URL/host | Uninstall → install with new URL (same secret) → re-enable in rooms |

---

*Last verified: 2026-08-26 — Nextcloud AIO 13.5 · Nextcloud 34 · Talk 24.0.4 · bot commit with AS2 parser + signed reply client.*
