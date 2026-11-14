#!/usr/bin/env bash
# Build the page and put the public copy on Fly (the image is built on Fly, not on this machine).
# Readers are kept on one volume, so it runs as exactly one machine.
set -euo pipefail
cd "$(dirname "$0")/.."
APP=${FLY_APP:-readback-demo}
(cd web && bun install >/dev/null && bunx tsc -b && bun run build >/dev/null)
hsec exec --only FLY_API_TOKEN -- flyctl status --app "$APP" >/dev/null 2>&1 || hsec exec --only FLY_API_TOKEN -- flyctl apps create "$APP" --org "${FLY_ORG:-helios-one}"
hsec exec --only FLY_API_TOKEN -- flyctl volumes list --app "$APP" 2>/dev/null | grep -q readback_data || hsec exec --only FLY_API_TOKEN -- flyctl volumes create readback_data --app "$APP" --region arn --size 1 --yes
hsec exec --only JUNCTION_GEMINI_API_KEY,FLY_API_TOKEN -- sh -c 'flyctl secrets set GEMINI_API_KEY="$JUNCTION_GEMINI_API_KEY" --app "$1" --stage' sh "$APP"
# the judge link (/auth/judge?k=...) and the key the watcher reports back with (deploy/carried.ts)
hsec exec --only READBACK_JUDGE_KEY,READBACK_CARRY_KEY,FLY_API_TOKEN -- sh -c 'flyctl secrets set RB_JUDGE_KEY="$READBACK_JUDGE_KEY" RB_CARRY_KEY="$READBACK_CARRY_KEY" --app "$1" --stage >/dev/null' sh "$APP"
# signs the sign-in cookie; made once on Fly and never read back
hsec exec --only FLY_API_TOKEN -- flyctl secrets list --app "$APP" 2>/dev/null | grep -q RB_AUTH_SECRET || hsec exec --only FLY_API_TOKEN -- sh -c 'flyctl secrets set RB_AUTH_SECRET="$(openssl rand -hex 32)" --app "$1" --stage >/dev/null' sh "$APP"
hsec exec --only FLY_API_TOKEN -- flyctl deploy --app "$APP" --config deploy/fly.toml --dockerfile deploy/Dockerfile --remote-only --ha=false .
hsec exec --only FLY_API_TOKEN -- flyctl scale count 1 --app "$APP" --yes >/dev/null
URL="https://${APP}.fly.dev"
curl --fail --silent --show-error "$URL/healthz" >/dev/null
echo "$URL"
