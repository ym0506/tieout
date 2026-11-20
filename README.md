# Tie-Out

Tie-Out checks the facts written on Confluence pages against Jira, the system of record.

A status page says "PAY-12 ships Dec 3, owner Minsu". Two weeks ago Jira moved it to Dec 17 and reassigned it.
Nobody edited the page. People read the page, and so do AI assistants, and both repeat the old date.

Tie-Out finds every due date, owner, status, fix version and priority that a page states about a Jira work item,
compares it with Jira, and marks the ones that are no longer true, with the date they stopped being true and one click to correct them.
The same check is available to Rovo agents and to any MCP client, so a draft can be verified before it is published.

The name comes from audit practice: a report is "tied out" when every figure in it has been traced to its source.

## What it does

| Where | What you see |
|---|---|
| Confluence page, under the title | `Tie-Out: 2 out of date` or `Tie-Out: 7/7 tied`. Click for the full report. |
| Confluence page, top banner | Shown only when something on the page is out of date. "Update from Jira" rewrites the facts in place. |
| Jira work item panel | The pages that quote this work item, and which of them now say something it no longer says. |
| Confluence → Apps → Tie-Out | Site overview, page scan, and a sample page built from your own work items. |
| Rovo agent "Tie-Out" | Verifies a draft or a page before you rely on it. |
| MCP server "Tie-Out" | Three tools for custom agents in Rovo Studio and third-party MCP clients: `verify-claims`, `check-page`, `get-fact`. |

## How it decides

By rule, not by a language model.

1. Read the page as ADF. Find work items: smart links, links to `/browse/KEY`, plain keys.
2. Take a claim only when the text leaves no doubt which work item it is about:
   a table row with one work item and columns named Owner, Due, Status, Version or Priority;
   a two-column "page properties" table about one work item; or a sentence (or clause) naming exactly one work item.
3. Normalise what people write: `Dec 3`, `3 Dec 2026`, `2026-12-03`, `12월 3일`; first names; `WIP`, `shipped`, `완료`.
4. Compare with the Jira field. Three outcomes: **matches**, **out of date**, **not checked** (with the reason).
5. For out-of-date facts, read the work item's change history to say when the page stopped being true and who changed it.

When a work item changes, a Jira event re-checks only the pages that quote it.
The report a person sees is read with that person's permissions. The app stores counts and work item keys, never field values.

Rules are deliberately conservative. A date with no cue word, a row naming two work items, a day/month order that could be read
two ways, a status word that is not in the workflow: these are left alone or reported as "not checked".

## Evidence

`docs/evidence/README.md`: run on 609 public Apache Flink design pages, 63 of 268 checkable facts (23.5%) disagree with Jira,
19 of them (7.1%) naming a release Jira contradicts outright. On 72 Apache Kafka release plans, 0 of 100 disagree.
The script is in this repository and can be re-run.

## Develop

```bash
npm install
```

```bash
npm test
```

```bash
node scripts/validate-manifest.cjs
```

90 tests: the engine (dates, names, statuses, tables, sentences, fixes), the Forge handlers end to end against an in-memory
site (`test/fake-site.js`), and every UI state.

Forge CLI 15 needs Node 22.23+ or 24.22+. `scripts/forge.sh` runs the project's CLI with Node 24 from `~/.nvm` when present.

```bash
./scripts/forge.sh deploy
```

## Layout

```
src/engine/      pure rules: extract claims from ADF, normalise, compare, fix
src/core.js      use cases, written against four adapters (jira, confluence, store, graph)
src/forge/       Forge adapters and entry points (resolvers, events, actions)
src/frontend/    UI Kit screens
skills/          Rovo skill: verify-before-publish
scripts/         manifest validation, public-data measurement
docs/            evidence, submission notes
```

## Limits

- Reads facts in tables and sentences. A fact spread over several sentences ("PAY-12 is late. It now ships Dec 17.") is not tied to the work item.
- Fields: due date, assignee, status, fix version, priority. Custom fields are not read yet.
- A fact formatted across styles (`**Dec** 3`) is reported but must be edited by hand.
- Teamwork Graph and Rovo MCP are Preview features; the app works without them and adds owner and linked-page context when they are available.
