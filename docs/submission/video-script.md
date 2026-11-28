# Demo video script (target 3:45, hard limit 5:00)

Rules that apply: under 5 minutes, public on YouTube, English (or English subtitles), shows the app working,
no third-party logos or copyrighted music. For the MCP part use Rovo Studio, so no outside product's logo is on screen.

Recorded from the real demo site with on-screen captions; a voice track reading the same lines is optional.
1920×1080, browser zoom 110%, notifications off. Rovo answers vary from run to run: record the Rovo scene
several times and use a run whose answer matches what the caption says, or change the caption.

Prepare beforehand: the "Onboarding weekly status" page (no Tie-Out note on it), one Jira work item open in a second tab,
a Rovo Studio agent with the three Tie-Out tools added.

| Time | On screen | Caption |
|---|---|---|
| 0:00–0:25 | "Onboarding weekly status" page. Rovo panel: "Summarise the Weekly status table on this page for my manager". The answer: MOBL-57 due Nov 6, Mitch Davis, overdue. | "A weekly status page. I ask Rovo to summarise it for my manager." / "Rovo reports MOBL-57 as due Nov 6, owned by Mitch Davis, overdue." |
| 0:25–0:40 | Second tab, Jira MOBL-57: no due date, a different assignee. | "In Jira, MOBL-57 has no due date and a different owner. Nothing on the page says so." |
| 0:40–0:55 | Back on the page: Tie-Out banner, badge "Tie-Out: 3 out of date". | "Tie-Out checks each date, owner and status on the page against Jira." |
| 0:55–1:30 | Click the badge: the report. Point at page says / Jira says / "True until … · changed by …". | "For each fact: what the page says, what Jira says, and when it stopped being true, from the Jira history." |
| 1:30–1:50 | Press `Write "…"` on one row, reload, open page history: new version "Tie-Out: synced 1 fact with Jira". | "One click rewrites only that cell and saves a new page version." |
| 1:50–2:25 | Jira tab: change the due date of another work item. Back to the page, reload: the badge count goes up. Then the Tie-Out panel on that work item. | "I change a due date in Jira. An event re-checks only the pages that quote this work item." / "In Jira, the work item lists the pages that quote it and what each now gets wrong." |
| 2:25–2:55 | Rovo Chat with the Tie-Out agent: "Check this before I send it: …" with one wrong date. The agent's corrected draft. | "Before an update goes out, the Tie-Out agent checks it and corrects what is out of date." |
| 2:55–3:10 | Rovo Studio: a custom agent with `verify-claims`, `check-page`, `get-fact` listed; one call to `verify-claims`. | "The same check is exposed as MCP tools, for agents in Rovo Studio and outside MCP clients." |
| 3:10–3:30 | Slide with two tables from `docs/evidence`: Flink 71 of 288 flagged (24 name a different release, 1 misread), Kafka 0 of 100; seeded changes 316 of 317 caught, 0 alarms on 302 cosmetic changes. | "On 609 public Apache Flink design pages, Tie-Out flags 71 of 288 checkable facts. 70 are real disagreements with Jira." / "When I changed the Jira value under 317 correct facts, it caught 316. It raised no alarm on 302 cosmetic changes." |
| 3:30–3:45 | Page with label `tieout-ignore`, badge "Tie-Out: off". End card: "Tie-Out · github.com/ym0506/tieout". | "Pages meant to stay as written can be left out with a label." / "Tie-Out. Rules decide each verdict, and it reads Jira and Confluence with your own permissions." |

## Shots to capture separately

- Page history showing the new version and its message.
- The "Not checked" row with its reason (write `early Q1` in a Due cell).
- The report section "Who and what else is affected (from Teamwork Graph)" on a page that links to another page.

## Thumbnail

Left half: "Page says Nov 6". Right half: "Jira: no due date". Small caption: Tie-Out.
