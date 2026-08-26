#!/bin/sh
# Test helper: send a signed fake-Talk webhook to the bot (inside docker network)
# usage: TALK_SECRET=<secret> sh send-hook.sh /tmp/hook.json [nextcloud-container]
secret="${TALK_SECRET:?Set TALK_SECRET env var (value from occ talk:bot:install)}"
container="${2:-nextcloud-aio-nextcloud}"
random=$(openssl rand -hex 32)
body=$(cat "$1")
sig=$(printf '%s' "${random}${body}" | openssl dgst -sha256 -hmac "$secret")
sig=${sig##* }
docker cp "$1" "$container":/tmp/hook.json >/dev/null
docker exec "$container" sh -c "random=$random; sig=$sig; curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -H \"X-Nextcloud-Talk-Random: $random\" \
  -H \"X-Nextcloud-Talk-Signature: $sig\" \
  --data-binary @/tmp/hook.json \
  http://ami-talk-bot:3979/api/talk/webhook"
