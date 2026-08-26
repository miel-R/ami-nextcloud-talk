#!/bin/sh
# Test helper: send a signed fake-Talk webhook to the bot (inside docker network)
# usage: sh send-hook.sh <hook-json-file> [nextcloud-container]
# The secret is read from TALK_SECRET env var (never hardcoded).
secret="${TALK_SECRET:?Set TALK_SECRET env var (value from occ talk:bot:install)}"
file="$1"
container="${2:-nextcloud-aio-nextcloud}"
docker cp "$file" "$container":/tmp/hook.json >/dev/null || exit 1
docker exec "$container" sh -c "
secret='$secret'
random=\$(openssl rand -hex 32)
body=\$(cat /tmp/hook.json)
sig=\$(printf '%s' \"\${random}\${body}\" | openssl dgst -sha256 -hmac \"\$secret\")
sig=\${sig##* }
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -H \"X-Nextcloud-Talk-Random: \$random\" \
  -H \"X-Nextcloud-Talk-Signature: \$sig\" \
  --data-binary \"\$body\" \
  http://ami-talk-bot:3979/api/talk/webhook"
