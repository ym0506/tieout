#!/bin/sh
# One-time setup after `./scripts/forge.sh login`:
# registers the app under your Atlassian account, provisions the free Codegeist demo site,
# deploys to the development environment and installs it into Confluence and Jira on that site.
# Safe to re-run: each step is skipped or repeated harmlessly if already done.
set -e
cd "$(dirname "$0")/.."
FORGE=./scripts/forge.sh

if grep -q "00000000-0000-0000-0000-000000000000" manifest.yml; then
  echo "== 1/5 Registering the app (writes the new app id into manifest.yml)"
  $FORGE register "Tie-Out"
else
  echo "== 1/5 App already registered"
fi

echo "== 2/5 Checks"
npm test --silent
$FORGE lint

echo "== 3/5 Demo site (Jira, Confluence, JSM, Rovo; free for 90 days)"
$FORGE site provision || echo "   (if this is still provisioning, wait and run this script again)"

echo "== 4/5 Deploy to development"
$FORGE deploy --non-interactive -e development

echo "== 5/5 Install on the demo site: Confluence first (required), then Jira"
$FORGE install --demo-site -p Confluence -e development --confirm-scopes --non-interactive || $FORGE install --demo-site -p Confluence -e development --upgrade --confirm-scopes --non-interactive
$FORGE install --demo-site -p Jira -e development --confirm-scopes --non-interactive || $FORGE install --demo-site -p Jira -e development --upgrade --confirm-scopes --non-interactive

echo
echo "Done. Open Confluence on the demo site → Apps → Tie-Out → Create sample page."
