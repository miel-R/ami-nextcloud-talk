#!/bin/sh
# Test helper: send a signed fake-Talk webhook to the bot (inside docker network)
# usage: send-hook.sh /tmp/hook.json
secret="7e43d0d990f4856ec91052413bbaf33f95288276"
random=$(openssl rand -hex 32)
body=$(cat "$1")
sig=$(printf '%s' "${random}${body}" | openssl dgst -sha256 -hmac "$secret")
sig=${sig##* }
curl -s -o /dev/null -w "webhook: HTTP %{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Nextcloud-Talk-Random: $random" \
  -H "X-Nextcloud-Talk-Signature: $sig" \
  --data-binary "$body" \
  http://ami-talk-bot:3979/api/talk/webhook
