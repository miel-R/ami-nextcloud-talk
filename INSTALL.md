# Install Ami for Nextcloud Talk — step-by-step

Step-by-step deployment of the **Ami** help-desk bot against the **stock
Nextcloud stack** (`nextcloud-stock-customs` — `nextcloud:stable-fpm` + nginx +
Postgres + Redis, external network `nextcloud-network`).

> The companion repo's README and old `DEPLOYMENT.md` reference an **AIO** layout
> (`nextcloud-aio` network, `nextcloud-aio-nextcloud:80`, `docker exec nextcloud`).
> The stock FPM stack uses a **different** network, endpoint, volume and `occ`
> command — it is **not** AIO. Everything below is written for the stock stack,
> so follow this guide, not the AIO references in the older docs.

---

## What you end up with

```
┌──────────────────────────────── Docker host ────────────────────────────────┐
│                                                                              │
│        stock network (nextcloud-network)                                     │
│        ┌──────────────────────────────────────────────────────────┐          │
│        │  nextcloud-app (FPM)       nextcloud-nginx               │          │
│        │  ──────────────            ──────────────                │          │
│        │  /var/www/html ── shared ─► /var/www/html:ro ──┐         │          │
│        │  (volume nextcloud_www)   nextcloud-nginx:80   │         │          │
│        └────────────────────────────────────────────────┼─────────┘          │
│                        webhook        http://ami-talk-bot:3979              │
│        ami-talk-bot ◄────────────────────────────────────────────────────┐  │
│        (Node/TS bot, joins nextcloud-network)                            │  │
│          │ mounts nextcloud_www:/var/www/html:ro (filesystem image read) │  │
│          └─► {server}/ocs/v2.php/apps/spreed/api/v1/bot/.../message       │  │
│              (TALK_SERVER_URL=http://nextcloud-nginx:80)                  │  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Ami** joins the stock `nextcloud-network`, so Nextcloud reaches it at
  `http://ami-talk-bot:3979/api/talk/webhook` (no public port exposed).
- Ami reaches **Nextcloud** at `http://nextcloud-nginx:80` (the nginx sidecar,
  HTTP on the docker network — internal only).
- Ami mounts the **`nextcloud_www`** volume at `/var/www/html:ro` so it can read
  shared images straight from disk when no public-share link or WebDAV works.

---

## 1. Prerequisites

| Requirement | Where it comes from |
| --- | --- |
| A running **stock** Nextcloud stack | `nextcloud-stock-customs`, app = `nextcloud:stable-fpm`, see its `INSTALL.md` |
| The **Talk** app enabled + HPB registered | `nextcloud-stock-customs` INSTALL step 11 (`talk:signaling:add`, `talk:turn:add`) |
| `occ` access | `docker compose exec nextcloud-app php occ ...` (run from the stock repo dir) |
| Docker + Compose | for the bot container; Node.y 22 only needed if you run the bot bare-metal |
| One AI API key | `GEMINI_API_KEY` or `OPENAI_API_KEY` (via `./env/.env.dev.user`) |

The stock network **must already exist** — it's created when the stock stack is
deployed (`docker network create nextcloud-network`, stock INSTALL step 6).

---

## 2. Register the bot in Nextcloud (server side)

**Step A — generate a secret** (40–128 chars; `occ` rejects shorter; keep it
hex so it is URL-safe):

```bash
openssl rand -hex 20      # 20 bytes = 40 hex chars
# PowerShell: $b = New-Object byte[] 20; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join ""
```

Save the output — you need the exact same value in step 3 and here.

**Step B — create a room the bot will live in** (do once, optional if you
already have a room; note the room **token**, e.g. `kntczu8k`, from the URL):

```bash
# from the stock repo dir — create a group conversation
docker compose exec nextcloud-app php occ talk:room:create "Ami Help Desk" --user admin --user test1
docker compose exec nextcloud-app php occ talk:room:promote kntczu8k admin test1
```

Promote users to **moderator** — enabling a bot in a room needs moderator rights.

**Step C — register the bot with BOTH feature flags.**

> `--feature webhook` lets it *hear* messages; `--feature response` lets it
> *reply*. Registering with only `response` makes a **silent bot** — Talk
> skips dispatching webhooks entirely. This is the #1 mistake.

```bash
docker compose exec nextcloud-app php occ talk:bot:install \
    Ami \
    <SECRET> \
    http://ami-talk-bot:3979/api/talk/webhook \
    "Ami Help Desk assistant" \
    --feature webhook --feature response
# → "Bot installed, ID: N"   (note the numeric ID)
```

Replace `<SECRET>` with the hex string from step A (no angle brackets).

> The webhook URL `http://ami-talk-bot:3979/api/talk/webhook` **must match the
> container name** in `docker-compose.yml` step 3 — that is how Nextcloud reaches
> the bot over the shared network.

Verify registration:

```bash
docker compose exec nextcloud-app php occ talk:bot:list
# shows ID, state, features, error_count
```

---

## 3. Build and run the bot container

**Step A — configure the bot.** Create `env/.env.dev.user` (git-ignored) from
`.env.example` and fill the required values for the **stock** stack:

```bash
# in the ami-nextcloud-talk repo dir
mkdir -p env
cp .env.example env/.env.dev.user
```
```bash
# env/.env.dev.user — example for the stock stack
PORT=3979
COMPANY_NAME=Amertron Corporation

# Bot reaches Nextcloud via the nginx sidecar on the docker network (internal, no TLS)
TALK_SERVER_URL=http://nextcloud-nginx:80
# Same hex secret you used in 2.C
SECRET_TALK_SECRET=<SECRET>
# Recommend true: only answer when the word "ami" appears in the message
TALK_REQUIRE_MENTION=true

# Pick ONE provider (auto detects by which key is set)
AI_PROVIDER=auto
GEMINI_API_KEY=<your-key>
# or OPENAI_API_KEY=<your-key>

# Nextcloud user for the WebDAV image-download fallback; must be a room member
TALK_ADMIN_USER=admin
SECRET_TALK_ADMIN_PASSWORD=<admin-password>
```

> `TALK_SERVER_URL` must match the domain Nextcloud serves replies from. On the
> shared docker network the internal `http://nextcloud-nginx:80` works and keeps
> bot→Nextcloud traffic off the internet. If you change the Nextcloud domain,
> update this to the public base URL (no trailing slash) and restart.

**Step B — point the compose file at the stock network and volume.** The repo's
`docker-compose.yml` still targets AIO (`nextcloud-aio` network, `nextcloud-aio_nextcloud`
volume). Change it to the stock values:

```yaml
services:
  ami-talk-bot:
    build: .
    container_name: ami-talk-bot
    restart: unless-stopped
    networks:
      - nextcloud-network
    env_file: env/.env.dev.user
    volumes:
      - ami-data:/app/data
      - nextcloud_www:/var/www/html:ro

networks:
  nextcloud-network:
    external: true

volumes:
  ami-data:
  nextcloud_www:
    external: true
```

> The `/var/www/html:ro` mount is the **Nextcloud data volume** (`nextcloud_www`),
> used by the filesystem image-download fallback. On the stock stack that volume
> exists only because `compose.yaml` names it `nextcloud_www`. Verify it exists
> with `docker volume ls | grep nextcloud_www` before starting.

**Step C — build and start:**

```bash
docker compose up -d --build

# verify health
curl http://localhost:3979/api/health
# → {"status":"healthy","talkConfigured":true,...}
docker compose logs ami-talk-bot --tail 20
```

**Step D — confirm Nextcloud can reach the bot:**

```bash
# from the stock repo dir — Nextcloud resolves the bot by container name
docker compose exec nextcloud-app curl -s -o /dev/null -w "%{http_code}\n" http://ami-talk-bot:3979/api/health
# → 200
```

---

## 4. Enable Ami in a room

Registration alone does nothing — bots are opt-in **per room**.

**Option A — UI:** open the Talk conversation → ⚙ conversation settings →
**Bots** → toggle **Ami** on.

**Option B — API** (as room moderator):

```
POST /ocs/v2.php/apps/spreed/api/v1/bot/{ROOM_TOKEN}/{BOT_ID}
Header: OCS-APIRequest: true
→ 201 Created (200 = already enabled)
```

Use API version **`v1`** (not `v4` — on some Talk builds `v4` returns 404/998 for
this route). The room owner/moderator must e.g. come from
`occ talk:room:promote <token> admin`.

---

## 5. Go-live checklist

1. Bot container up — `curl http://localhost:3979/api/health` → healthy.
2. Bot registered with `--feature webhook --feature response` (step 2.C).
3. Bot enabled in the room (step 4).
4. `SECRET_TALK_SECRET` in `env/.env.dev.user` equals the secret in 2.C.
5. `TALK_SERVER_URL` matches where Nextcloud serves requests.
6. Post a message → `docker compose logs ami-talk-bot` shows
   `📨 Room ... | user: "..."`, then `📤 Reply posted`.

---

## 6. Nextcloud-side identity (optional but recommended)

Create the Talk **HPB** wiring and grant the bot's admin account what it needs.
For a help-desk bot a dedicated `helpdesk` group is cleanest:

```bash
# from the stock repo dir
docker compose exec nextcloud-app php occ group:add helpdesk
```

Ami recognizes anyone in the Nextcloud `admin` group as bot admin (takes a
provisioning-API hit), so adding `TALK_ADMIN_USER` to `admin` (or listing it in
`TALK_ADMIN_USER`) enables the admin-only commands.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Bot registered & enabled but **never receives anything**; `error_count` stays 0 | Registered **without `--feature webhook`**. Reinstall with `--feature webhook --feature response` (step 2.C) |
| Webhook arrives, AI answers, reply **401** | Reply signature covers the **message text only**, not the JSON body — the code already does this; make sure `SECRET_TALK_SECRET` matches exactly |
| Reply fails **404 / statuscode 998** | Use `{SERVICE}`-style URLs: Talk ≥17 wants `/bot/{ROOM_TOKEN}/message`; keep the secret out of URL path segments (headers carry auth) |
| Bot replies but nothing appears in the room | Signature mismatch → Talk throttles silently. Verify header names, secret match, random ≥32 chars |
| Bot container up but Nextcloud can't reach it | Network mismatch: bot must be on `nextcloud-network`. `docker compose exec nextcloud-app curl http://ami-talk-bot:3979/api/health` must be 200 |
| `No such container: nextcloud` when running `occ` | Stock stack has no Apache `nextcloud` container — run `occ` via `docker compose exec nextcloud-app php occ ...` |
| Image analysis always fails ("could not download") | Missing `nextcloud_www:/var/www/html:ro` mount, or `TALK_ADMIN_USER` not a room member. Verify `docker volume ls \| grep nextcloud_www` |
| AppAPI / ExApps warning in admin | `app_api` installed-but-disabled (stock default) — not needed for webhook bots; skip or `occ app:enable app_api` |
| Bot worked, stopped after server change | Reinstalling the bot issues a **new bot ID** — re-enable it per room (step 4) |