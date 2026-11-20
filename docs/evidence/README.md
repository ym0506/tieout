# Does this happen on real pages? A measurement on public Apache data

Measured on 2026-11-20 with `scripts/measure-apache.mjs`, which runs Tie-Out's engine unchanged
(`src/engine`) over public wiki pages and compares what they say with the public Jira.
Anyone can re-run it: it only reads public pages, anonymously, with a pause between requests.

```bash
node scripts/measure-apache.mjs flink
```

```bash
node scripts/measure-apache.mjs kafka
```

## Result

| | Apache Flink design pages (FLIPs) | Apache Kafka release plans |
|---|---|---|
| Pages read | 609 | 72 |
| Pages that state a fact about a Jira work item | 293 | 15 |
| Facts found | 302 | 170 |
| Facts Tie-Out could check | 268 | 100 |
| Match Jira | 205 | 100 |
| **Disagree with Jira** | **63 (23.5%)** | **0 (0%)** |

What the 63 disagreements on the Flink pages are:

| Kind | Count | Share of 268 | Example |
|---|---|---|---|
| Page names one Flink release, Jira's fix version is another | 19 | 7.1% | FLIP-291 says release 1.18, FLINK-31316 has fix version 2.5.0 |
| Page names a release, Jira has no fix version | 38 | 14.2% | FLIP page says 1.13, the work item has none |
| Page and Jira use different version naming (connector or operator releases) | 4 | 1.5% | page says 1.17, Jira says mongodb-1.0.0 |
| Other fields | 2 | 0.7% | FLIP-156 says "in progress", FLINK-20835 is Closed |

Of the 63 pages with a disagreement, 31 were last edited in 2022, 12 in 2023, 16 in 2024, 3 in 2025 and 3 in 2026.
Nobody went back to them.

## How to read this

- **The narrow number is 7.1%.** 19 of 268 checkable facts name a release that Jira contradicts outright.
  The 23.5% figure also counts cases where Jira is the incomplete side (no fix version) or uses another naming scheme.
  Those are still places where the page and the system of record disagree, but they are not all "the page is wrong".
- **The Kafka pages show the opposite case, and that is useful too.** Their checkable cells say "Done", the work items
  are resolved, and Tie-Out raised nothing on 100 of 100. A check that cries wolf on finished work would be worse than no check.
- 70 Kafka cells and 34 Flink cells were left as "not checked" because they use words Jira does not have
  ("KIP Accepted", "Partially done") or are not a version or date. Tie-Out says so instead of guessing.
- One of the 63 is an extraction mistake: a cell containing only "FLINK-" under an owner heading was read as a name.

## Limits

- This is Confluence and Jira Data Center of open-source projects, not a company's Cloud site.
  Company status pages carry more dates and owners than these pages do; this data mostly exercises releases and statuses.
- Design pages are written at one moment. Some authors would say the release line records the plan, not the outcome.
- Only facts Tie-Out's rules can read are counted: a fact in a table row, a page-properties table, or the same sentence as the work item.
- Storage-format XHTML was converted to the subset of ADF the engine reads (`scripts/storage-to-adf.mjs`). The Forge app does not need this step.

## What the measurement changed in the product

Running on real pages exposed three false alarms, each now covered by a test:

1. `FLINK-2.4` in a release cell was read as work item `FLINK-2`. A key followed by `.digit` is now a version, not a key.
2. Unfilled template slots such as `<Flink Version>` were read as claims. They now count as saying nothing.
3. Words in a release cell ("To be created") were compared as if they were a version. They are now "not checked".

Raw output: `apache-flink-flips.json`, `apache-kafka-release-plans.json` (every disagreement with page, work item, page text and Jira value).
