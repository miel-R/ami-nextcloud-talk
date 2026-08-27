# Ami for Nextcloud Talk

Standalone **Nextcloud Talk bot** that carries over the personality of *Ami*, the Amertron Help Desk assistant (from `CODENAME-AMI-TEAMS-CENGINEv1`): warm Taglish/English mirroring, IT help desk behavior, confidentiality guard, and the familiar commands.

> 🧩 **Built for [Nextcloud All-in-One](https://github.com/nextcloud/all-in-one)** — companion repo: [`nextcloud-aio-customs`](https://github.com/miel-R/nextcloud-aio-customs) documents the AIO deployments this bot runs on: the **Tailscale-Funnel** setup (no open ports, `*.ts.net`) and the **production server** setup (ports 80/443/3478 open, real domain). Both deploy Ami **container-to-container** on the `nextcloud-aio` network.

It does **not** use the Bot Framework / Microsoft 365 Agents Toolkit — Nextcloud Talk has its own bot protocol (webhook in, signed OCS request out), so this project implements that directly while reusing Ami's persona, AI service, and conversation logic.

## How Nextcloud Talk bots work

1. You register a bot URL + name with `occ talk:bot:install` → Nextcloud generates a shared **secret**.
2. When a message is posted in a room where the bot is enabled, Talk POSTs a JSON webhook to the bot URL, signed with `X-Nextcloud-Talk-Random` / `X-Nextcloud-Talk-Signature` (HMAC-SHA256 of random + raw body using the secret).
3. The bot replies by POSTing to `{server}/ocs/v2.php/apps/spreed/api/v1/bot/{SECRET}/message`, signed the same way.

This project handles all of that.

## Quick start

```bash
npm install

# 1. Register the bot on your Nextcloud instance (run inside the AIO nextcloud container):
#    docker exec -u www-data nextcloud-aio-nextcloud php occ talk:bot:install \
#        Ami <SECRET> http://ami-talk-bot:3979/api/talk/webhook \
#        "Ami Help Desk assistant" --feature webhook --feature response
#
#    → note the SECRET / bot ID it prints
#
#    (Local dev alternative — bot running on the Windows host instead of a container:
#     use http://host.docker.internal:3979/api/talk/webhook, which Docker Desktop
#     containers resolve via the host gateway.)
#
# 2. Copy .env.example to env/.env.dev.user and fill in TALK_SERVER_URL,
#    SECRET_TALK_SECRET and your AI key(s).
mkdir env
copy .env.example env\.env.dev.user

npm run dev
```

The webhook listens on `http://localhost:3979/api/talk/webhook`.

> For the **containerized** deploy (recommended, and what production uses), the bot runs
> as the `ami-talk-bot` container on the `nextcloud-aio` network, so Nextcloud reaches it
> at `http://ami-talk-bot:3979/api/talk/webhook`. `host.docker.internal` is only for the
> bot running directly on the Windows host. See [`DEPLOYMENT.md`](DEPLOYMENT.md) §3–§4.

## Enable Ami in a room

Bots are enabled per conversation by the room owner:

- Open the Talk conversation → **conversation settings** → **Bots** → enable **Ami**

(or via API as room owner — **use API version `v1`, not `v4`**; on Talk 24 `v4` returns
404/998 for this route: `POST /ocs/v2.php/apps/spreed/api/v1/bot/{token}/{botId}` with
header `OCS-APIRequest: true` → `201 Created`. The room owner must be a **moderator** —
`occ talk:room:create --user admin` adds admin as a plain participant, so run
`occ talk:room:promote {token} admin` first, or the enable call returns `403`.)

Then just chat — or type `/help`.

## Commands

Same as the Teams version:

| Command | What it does |
|---|---|
| `/help` | Show the help message |
| `/status` | Show current conversation state |
| `/reset` | Clear conversation history |
| `/end` (`/exit`, `/quit`) | End the conversation |

## Configuration

Loaded from `.env` then `env/.env.dev.user` (secrets override). See `.env.example`:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3979` |
| `TALK_SERVER_URL` | Your Nextcloud base URL (no trailing slash) | — |
| `SECRET_TALK_SECRET` | Secret from `talk:bot:install` | — |
| `TALK_WEBHOOK_PATH` | Webhook route | `/api/talk/webhook` |
| `TALK_REQUIRE_MENTION` | Only reply when @Ami is mentioned | `false` |
| `AI_PROVIDER` | `auto` \| `gemini` \| `openai` \| `azure` | `auto` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `AZURE_*` | AI keys | — |
| `SENSITIVE_TOPICS` | Extra blocked phrases | built-in list |
| `SESSION_TIMEOUT` | Idle conversation cleanup (ms) | `120000` |

With no AI key configured, the bot runs but answers with a "no AI configured" notice.

## Personality carried over from Teams Ami

- Master system prompt: warm, empathetic help desk agent for Amertron
- Language mirroring: casual everyday Taglish for Tagalog speakers, natural English otherwise — never switching mid-conversation
- Confidentiality guard blocks sensitive topics (sweldo/sahod, pricing, credentials…) before any AI call
- Escalation detection: `[CREATE_TICKET]` intent or explicit "create ticket" requests get logged-for-the-team responses
- Rate limiting per user, idle session cleanup, multi-turn history per user per room
- 📸 **Image analysis**: share a picture with `@Ami` in the caption and she'll analyze it (Gemini vision / GPT-4o) — screenshots of errors get diagnosed like a help desk agent. Replies are posted **in-thread** via `replyTo`.

## Production notes

- Run behind HTTPS or keep it on the local network only; anyone who can reach the webhook without the secret cannot forge messages (signature verified when `TALK_SECRET` is set).
- For production-style run: `npm run build && npm start`, or build the Docker image and run it on the `nextcloud-aio` network (see [`DEPLOYMENT.md`](DEPLOYMENT.md) §4). The recommended production topology is **container-to-container**: Nextcloud → `http://ami-talk-bot:3979` (webhook) and bot → Nextcloud (internal Apache or the public HTTPS URL) — the Funnel/public port is only for external user traffic. Full server deployment (real domain, ports 80/443/3478, Let's Encrypt) is documented in the companion repo's [`SERVER-DEPLOYMENT.md`](https://github.com/miel-R/nextcloud-aio-customs/blob/main/SERVER-DEPLOYMENT.md).
- To remove the bot later: `occ talk:bot:uninstall <id>` (lists IDs via `occ talk:bot:list`). Reinstalling generates a new bot ID, so re-enable it in each room afterward.
