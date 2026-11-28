# Does this happen on real pages? A measurement on public Apache data

`scripts/measure-apache.mjs` runs Tie-Out's engine (`src/engine`) over public wiki pages and compares
what they say with the public Jira. It only reads public pages, anonymously, with a pause between requests.
Pages were read on 2026-11-20 and Jira on 2026-11-27.

```bash
node scripts/measure-apache.mjs flink
```

```bash
node scripts/measure-apache.mjs kafka
```

`FETCH=curl` in front of either command uses curl instead of Node's fetch, for networks where only curl gets through.

## Result

| | Apache Flink design pages (FLIPs) | Apache Kafka release plans |
|---|---|---|
| Pages read | 609 | 72 |
| Pages that state a fact about a Jira work item | 293 | 15 |
| Facts found | 302 | 170 |
| Facts Tie-Out could check | 288 | 100 |
| Match Jira | 217 | 100 |
| **Disagree with Jira** | **71 (24.7%)** | **0 (0%)** |

The 71 disagreements on the Flink pages:

| Kind | Count | Share of 288 | Example |
|---|---|---|---|
| Page names one release, Jira's fix version is another | 24 | 8.3% | FLIP-291 says release 1.18, FLINK-31316 has fix version 2.5.0 |
| Page names a release, Jira has no fix version | 41 | 14.2% | FLIP-530 says 2.0, FLINK-37853 has none |
| Page and Jira use different version naming (connector or operator releases) | 4 | 1.4% | FLIP-262 says 1.17, FLINK-6573 says mongodb-1.0.0 |
| Status | 1 | 0.3% | FLIP-156 says "in progress", FLINK-20835 is Closed |
| Extraction mistake | 1 | 0.3% | a cell holding only "FLINK-" under an owner heading was read as a name |

The 71 disagreements are on 71 different pages. They were last edited in 2022 (34), 2023 (13), 2024 (16), 2025 (5) and 2026 (3).

## How to read this

- **The narrow number is 8.3%.** 24 of 288 checkable facts name a release that Jira contradicts outright.
  The 24.7% figure also counts cases where Jira is the incomplete side (no fix version) or uses another naming scheme.
  Those are places where the page and the system of record disagree, but they are not all "the page is wrong".
- **70 of the 71 are real disagreements between the page and Jira.** One is Tie-Out reading the page wrongly.
- **The Kafka pages show the opposite case.** Their checkable cells say "Done", the work items are resolved,
  and Tie-Out raised nothing on any of the 100.
- 70 Kafka cells and 14 Flink cells were left as "not checked" because they use words Jira does not have
  ("KIP Accepted", "Partially done") or are not a version or date.

## Does it notice a change, and does it stay quiet on cosmetic ones?

`scripts/seeded-changes.mjs` takes every fact above that matches Jira, changes the Jira value under it in a copy of
Jira's answers (Jira itself is not touched), and checks the page again with the engine unchanged. Results are in `seeded-changes.json`.

| Change made in Jira | Facts | Tie-Out said "out of date" | Tie-Out said "matches" |
|---|---|---|---|
| A real change: the next release, a status in another category | 317 | 316 (99.7%) | 1 |
| A cosmetic change: `1.18` → `1.18.0`, `1.18.0` → `v1.18.0`, a status renamed within its category | 302 | 0 | 302 (100%) |

The one miss: FLIP-258 names two releases, "1.15.3/1.16", and the changed Jira value landed on 1.16, so the page still names it.
No fact about another work item changed its verdict in any of the 619 runs.

This only covers facts Tie-Out already reads. It says nothing about facts written in a form its rules skip.

## Held out

The rules were tuned on the Flink pages. Kafka's KIP design pages were not looked at while tuning and were measured once,
after the last rule change. Of 1,380 KIP pages, 13 state a fact Tie-Out can read (KIPs are mostly prose), 23 facts could be
checked, and 5 were flagged. Read against the page text, 3 of the 5 are real disagreements, 1 is a misreading
(a ZooKeeper version in the same sentence taken as the Kafka work item's release) and 1 depends on workflow wording.
Details: `kips-heldout-review.md`, raw output: `apache-kafka-kips-heldout.json`.

## What the measurement changed in the product

Running on real pages exposed three false alarms, each now covered by a test:

1. `FLINK-2.4` in a release cell was read as work item `FLINK-2`. A key followed by `.digit` is now a version, not a key.
2. Unfilled template slots such as `<Flink Version>` were read as claims. They now count as saying nothing.
3. Words in a release cell ("To be created") were compared as if they were a version. They are now "not checked".

The seeded-change test then exposed a miss: two versions that only shared a word, such as `ml-2.0.0` and `ml-2.1.0`,
were treated as the same release. Only tokens that contain a digit now identify a version. Before this fix the same test
caught 304 of 320 real changes; after it, 316 of 317. On the Flink pages the fix turned three facts from "matches" into
"out of date", for example FLIP-288 saying kafka-4.0.0 where Jira says kafka-3.1.0, which is why the count of facts that
match, and so the number of real changes tried, went from 320 to 317.

## A correction to the first run

The 20 November run reported 63 of 268. Its cache stored each batch of Jira answers under the first key and the batch size,
so when the rules changed and the batches changed, some batches were answered from an older file.
Work items that exist were then counted as "not found", and their facts as "not checked".
The cache is now keyed on every work item in the batch. With that fixed, and with the version rule above, the result is 71 of 288.

## Limits

- This is Confluence and Jira Data Center of open-source projects, not a company's Cloud site.
  Company status pages carry more dates and owners than these pages do; this data mostly exercises releases and statuses.
- Design pages are written at one moment. Some authors would say the release line records the plan, not the outcome.
- Only facts Tie-Out's rules can read are counted: a fact in a table row, a page-properties table, or the same sentence as the work item.
- Storage-format XHTML was converted to the subset of ADF the engine reads (`scripts/storage-to-adf.mjs`). The Forge app does not need this step.

Raw output: `apache-flink-flips.json`, `apache-kafka-release-plans.json`, `seeded-changes.json`, `apache-kafka-kips-heldout.json`.
