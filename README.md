# Tie-Out

Tie-Out checks the facts written on Confluence pages against Jira, the system of record.

A status page says "PAY-12 ships Dec 3, owner Minsu". Two weeks ago Jira moved it to Dec 17 and reassigned it.
Nobody edited the page. People read the page, and when an AI assistant is asked to summarise it, it repeats the old date too.

Tie-Out reads the due dates, owners, statuses, fix versions and priorities that a page states next to a Jira work item,
compares each with Jira, and marks the ones that are no longer true, with the date they stopped being true and one click to correct them.
The same check is available to Rovo agents and to any MCP client, so a draft can be verified before it is published.

The name comes from audit practice: a report is "tied out" when every figure in it has been traced to its source.

## What it does

| Where | What you see |
|---|---|
| Confluence page, under the title | `Tie-Out: 2 out of date` or `Tie-Out: 7/7 match`. Click for the full report. A page labelled `tieout-ignore` shows `Tie-Out: off`. |
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
The report a person sees is read with that person's permissions. The badge count is worked out in the background and shown to
everyone who can read the page, so it leaves out work items that have an issue security level or that the app cannot read. The app stores counts and work item keys,
never field values.

Rules are deliberately conservative. A date with no cue word, a row naming two work items, a day/month order that could be read
two ways, a status word that is not in the workflow: these are left alone or reported as "not checked".

## Evidence

`docs/evidence/README.md`: on 609 public Apache Flink design pages, 71 of 288 checkable facts (24.7%) disagree with Jira,
24 of the 288 (8.3%) naming a release that Jira contradicts outright. On 72 Apache Kafka release plans, 0 of 100 disagree.
Changing the Jira value under 317 facts that were right, Tie-Out flagged 316; under 302 cosmetic changes it flagged none.
The scripts are in this repository and can be re-run.

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

96 tests: the engine (dates, names, statuses, tables, sentences, fixes), the Forge handlers against an in-memory stand-in
for the Jira and Confluence REST APIs (`test/fake-site.js`), and the UI states.

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

- Reads facts in tables and sentences. A fact spread over several sentences ("PAY-12 is late. It now ships Dec 17.") is not linked to the work item.
- Fields: due date, assignee, status, fix version, priority. Custom fields are not read yet.
- A fact formatted across styles (`**Dec** 3`) is reported but must be edited by hand.
- Teamwork Graph and Rovo MCP are Preview features; the app works without them and adds owner and linked-page context when they are available.
