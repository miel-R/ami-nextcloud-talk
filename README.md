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

Then just chat — or type `$help`.

## Commands

User commands (work in any approved room):

| Command | What it does |
|---|---|
| `$help` | Show the help message (admins also see admin commands) |
| `$status` | Show who Ami is talking to (user + room) and the conversation state |
| `$whoami` | Show the account Ami recognises you as |
| `$reset` | Clear conversation history |
| `$end` (`$exit`, `$quit`) | End the conversation |

Admin commands — only the account in `TALK_ADMIN_USER` may run these, and they
work even in a room Ami would otherwise ignore:

| Command | What it does |
|---|---|
| `$approve` | Approve **this** room so Ami answers here |
| `$revoke` | Revoke **this** room's approval |
| `$list` | List every approved room |
| `$notify-add [<token>]` | Add a group chat that receives escalation tickets — with **no token it adds the room you're in** (auto-enables Ami there) |
| `$notify-remove [<token>]` | Remove a group chat from escalation notifications (no token = current room) |
| `$notify-list` | List the group chats that receive escalation tickets |
| `$notify-test` | Send a test ticket to every configured notification group and report what reached |

## Room approval gate

Ami stays silent in a room until the Nextcloud admin approves it:

1. Enable the bot in the room (room owner → conversation settings → Bots → Ami).
2. The admin sends `@Ami $approve` in that room.
3. Ami replies `✅ Room approved` and starts answering.

Until then, every message in the room (including `@Ami` mentions) is ignored.
Approvals are stored in `data/approved-rooms.json` and persist across container
rebuilds via the `ami-data` Docker volume. The admin can revoke a room with
`@Ami $revoke` or see all approved rooms with `@Ami $list`.

## Escalation to the Help Desk

When Ami can't resolve a request, she automatically starts a short structured
intake and files a ticket:

1. **Department** (e.g. IT / Help Desk, HR, Other)
2. **Category** (per department)
3. **System type** (per department + category)
4. **Problem** (free text)

The ticket is posted as Ami into every configured notification group chat. To
configure those groups (admin only):

- `@Ami $notify-add` — run this **inside** the target group chat (e.g. the
  "Ami Help Desk" group); it adds that room and auto-enables Ami there so she
  can post tickets. You can also pass a token to add a different room remotely:
  `@Ami $notify-add <roomToken>`. (The "Ami Help Desk" group is a good target —
  with chat disabled for humans, only Ami can post, so it's a clean notification sink.)
- `@Ami $notify-remove` (current room) or `@Ami $notify-remove <roomToken>` / `@Ami $notify-list`
- `@Ami $notify-test` — posts a test message into every configured group and
  tells you how many were reached and which (if any) failed.

Notification targets persist in `data/notify-rooms.json` (same volume).

> The bot must already be enabled in a room for its webhook (and thus the
> command) to arrive there — so for the no-token form, first enable Ami in the
> group once (conversation settings → Bots → Ami), then run `$notify-add`.

### Departments / categories / system types

These are **data-driven** from `ticket-categories.json` at the repo root (copied
into the image). IT is fully populated; HR and Other are `TODO` stubs. To add a
department or fill in categories, edit that file and rebuild:

```bash
npm run build && docker compose up -d --build
```

No code changes are needed — the intake menus are generated from the file.

## Configuration

Loaded from `.env` then `env/.env.dev.user` (secrets override). See `.env.example`:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3979` |
| `TALK_SERVER_URL` | Your Nextcloud base URL (no trailing slash) | — |
| `SECRET_TALK_SECRET` | Secret from `talk:bot:install` | — |
| `TALK_WEBHOOK_PATH` | Webhook route | `/api/talk/webhook` |
| `TALK_REQUIRE_MENTION` | Require `@Ami` to **start** a conversation; once a session is active, no mention is needed until it expires or ends | `false` |
| `TALK_ADMIN_USER` | Nextcloud account treated as the bot admin (WebDAV image downloads + all admin commands) | — |
| `TALK_BOT_ID` | Numeric bot id printed by `talk:bot:install`; used to auto-enable Ami in `$notify-add` rooms | `1` |
| `AI_PROVIDER` | `auto` \| `gemini` \| `openai` \| `azure` | `auto` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `AZURE_*` | AI keys | — |
| `SENSITIVE_TOPICS` | Extra blocked phrases | built-in list |
| `SESSION_TIMEOUT` | Idle conversation cleanup (ms) | `120000` |

With no AI key configured, the bot runs but answers with a "no AI configured" notice.

## Project structure

The code follows a layered layout (controllers → services → models, with
domain logic under `features`):

```
src/
  index.ts                     boot + graceful shutdown + idle-session farewell wiring
  app.ts                       express bootstrap, raw-body capture, route mounting

  controllers/                 HTTP handling — parse webhook, call services
    talk-webhook.controller.ts
    health.controller.ts

  services/                    business logic
    session.service.ts         SessionStore (in-memory, TTL, idle-expiry callback)
    room-approval.service.ts   RoomApprovalStore (file-backed room approval gate)
    talk.service.ts            TalkAgent: orchestrates a message → reply
    ai.service.ts              AI router (gemini / openai / azure)
    talk/                      Nextcloud Talk transport
      talk-client.service.ts   sendTalkMessage (signed OCS reply)
      talk-verify.service.ts   verifyTalkSignature + buildSignedHeaders
      talk-files.service.ts    downloadTalkImage (public share / WebDAV)

  models/                      data shapes
    user.model.ts              User { id, displayName, email } + fromActor()
    session.model.ts           Session { key, user, roomToken, history, ... }
    message.model.ts           HistoryItem, ImageData, NormalizedMessage
    webhook.model.ts           TalkActor/Webhook, FileParameter, render/extract

  features/                    fully-contained business domains
    agent/
      prompt.ts                MASTER_SYSTEM_PROMPT + buildSystemPrompt(user)
      commands.ts              /help, /status, /whoami, /end, /reset + admin commands
    ai/providers/              one file per AI backend
      gemini.ts  openai.ts  azure.ts

  config/config.service.ts     env loading + Config
  core/logger.ts               logger
```

### User sessions & identity

Ami now tracks **who** she is talking to, not just the raw message:

- Each conversation is a `Session` scoped per **room + user** (`User` parsed from the
  webhook `actor`: clean `id` with the `users/` prefix stripped, plus `displayName`).
- **Mention-to-start:** when `TALK_REQUIRE_MENTION` is on, the *first* `@Ami` mention
  opens the session; after that the user no longer needs to `@Ami` for the rest of the
   conversation — until it idles out (`SESSION_TIMEOUT`) or is ended (`$end`/`$reset`).
  A message with no `@Ami` and no active session is simply ignored.
- On the first message of a conversation she opens with a short **greeting that uses
  your name** (e.g. "Hi Maria! 👋"), and the system prompt always names the user so
  replies stay personal.
- `$status` reports the current user and room.
- Idle sessions expire after `SESSION_TIMEOUT` and Ami posts a **personalized farewell**
  that names the user back into the room (`features/agent/prompt.ts` → `buildFarewell`).
- `SessionStore` is an in-memory, pluggable store — swapping in Redis / `node-cache`
  later requires no change to the agent logic.

## Personality carried over from Teams Ami

- Master system prompt: warm, empathetic help desk agent for Amertron
- Language mirroring: casual everyday Taglish for Tagalog speakers, natural English otherwise — never switching mid-conversation
- Confidentiality guard blocks sensitive topics (sweldo/sahod, pricing, credentials…) before any AI call
- Escalation: when she can't resolve an issue she emits `[CREATE_TICKET]` and runs a guided **Department → Category → System → Problem** intake (menus from `ticket-categories.json`), then files the ticket into the configured Help Desk group(s) — see **Escalation to the Help Desk**
- Knows exactly who she's talking to: greets by name on a fresh conversation, personalizes replies via the system prompt, and `$status` reports the user + room (see **User sessions & identity** above)
- Rate limiting per user, idle session cleanup, multi-turn history per user per room
- 📸 **Image analysis**: share a picture with `@Ami` in the caption and she'll analyze it (Gemini vision / GPT-4o) — screenshots of errors get diagnosed like a help desk agent. Replies are posted **in-thread** via `replyTo`.

## Production notes

- Run behind HTTPS or keep it on the local network only; anyone who can reach the webhook without the secret cannot forge messages (signature verified when `TALK_SECRET` is set).
- For production-style run: `npm run build && npm start`, or build the Docker image and run it on the `nextcloud-aio` network (see [`DEPLOYMENT.md`](DEPLOYMENT.md) §4). The recommended production topology is **container-to-container**: Nextcloud → `http://ami-talk-bot:3979` (webhook) and bot → Nextcloud (internal Apache or the public HTTPS URL) — the Funnel/public port is only for external user traffic. Full server deployment (real domain, ports 80/443/3478, Let's Encrypt) is documented in the companion repo's [`SERVER-DEPLOYMENT.md`](https://github.com/miel-R/nextcloud-aio-customs/blob/main/SERVER-DEPLOYMENT.md).
- To remove the bot later: `occ talk:bot:uninstall <id>` (lists IDs via `occ talk:bot:list`). Reinstalling generates a new bot ID, so re-enable it in each room afterward.
