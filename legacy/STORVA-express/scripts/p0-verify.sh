#!/usr/bin/env bash
# STORVA P0 gate. Run from the project root on a machine WITH internet + Docker (e.g. a GitHub Codespace).
# Every step prints PASS / FAIL / BLOCKED. A step that could not run is never PASS.
# Razorpay live-API steps need RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (rzp_test_*) and are reported BLOCKED without them.
cd "$(dirname "$0")/.." || exit 1
declare -A R; ORDER=()
rec(){ R[$1]=$2; ORDER+=("$1"); echo ">> $1: $2"; }

node -v; npm -v
if npm install --no-audit --no-fund; then rec "npm install" PASS; else rec "npm install" FAIL; fi
[ -f package-lock.json ] && rec "package-lock.json exists (commit it!)" PASS || rec "package-lock.json exists (commit it!)" FAIL

out=$(npm run test:unit 2>&1); echo "$out" | tail -12
echo "$out" | grep -qE '^# fail 0' && rec "unit tests (fail 0; 11 browser skips expected)" PASS || rec "unit tests" FAIL

if docker info >/dev/null 2>&1; then
  docker compose -f docker-compose.test.yml up -d --wait
  export MONGODB_URI=mongodb://127.0.0.1:27018/storva_test
  out=$(npm run test:integration 2>&1); echo "$out" | tail -12
  if echo "$out" | grep -qE '^# fail 0' && echo "$out" | grep -qE '^# skipped 0'; then rec "MongoDB integration (fail 0, skipped 0)" PASS; else rec "MongoDB integration" FAIL; fi
else rec "MongoDB integration" BLOCKED; fi

if npx --no-install playwright --version >/dev/null 2>&1 || (npm i -D playwright --no-save && npx playwright install --with-deps chromium); then
  out=$(MONGODB_URI=${MONGODB_URI:-} node --test test/module6.browser.test.js 2>&1); echo "$out" | tail -12
  echo "$out" | grep -qE '^# pass 11' && echo "$out" | grep -qE '^# skipped 0' && rec "Playwright 11 browser tests" PASS || rec "Playwright 11 browser tests" FAIL
else rec "Playwright 11 browser tests" BLOCKED; fi

if [ -n "$RAZORPAY_KEY_ID" ] && [ -n "$RAZORPAY_KEY_SECRET" ] && [[ "$RAZORPAY_KEY_ID" == rzp_test_* ]]; then
  rec "Razorpay Test Mode (manual: follow STORVA-module6-verification-guide.md section 5, then run scripts/reconcile.js)" "MANUAL - not auto-verified"
else rec "Razorpay Test Mode" "BLOCKED (no rzp_test_ keys)"; fi

echo; echo "===== P0 SUMMARY ====="; for k in "${ORDER[@]}"; do printf '%-70s %s\n' "$k" "${R[$k]}"; done
