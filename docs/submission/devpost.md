# Devpost submission text

Category: **Apps for Business Teams**
Bonus prizes: **Best Agents (Rovo)**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**

---

## Project name

Tie-Out

## Tagline (max 200 characters)

A status page says Nov 6 and Mitch. Jira says no due date and someone else. Tie-Out checks the dates, owners and statuses on Confluence pages against Jira and rewrites the wrong cell.

## Inspiration

Program managers, marketing operations leads and HR coordinators often keep a weekly status page in Confluence: a table of work items with an owner, a due date and a status. The work is tracked in Jira and keeps changing, and the page gets updated when someone remembers.

I wanted to see what an AI assistant does with such a page, so I tried it on a Codegeist demo site. I took the sample status page Tie-Out builds, which has a few facts written wrong on purpose, and removed the note that says so. Its row for MOBL-57 says "Mitch Davis, Nov 6, 2026". In Jira, MOBL-57 has no due date and is assigned to someone else. On 27 November I asked Rovo, in three fresh chats, to "summarise the Weekly status table on this page for my manager". Each time it reported MOBL-57 as due Nov 6, owned by Mitch Davis, and overdue. When I asked once instead "Who owns MOBL-57 and when is it due?", Rovo looked in Jira and pointed out that the page disagreed. On the copy that still had the note, Rovo also checked Jira before summarising. Rovo got the facts right when something prompted it to look. When it summarised an ordinary page, it took the values from the page. Then I chose the Tie-Out agent in Rovo and asked the same thing, again in three fresh chats. Each summary used Jira's values and listed what it had corrected.

This matches an accepted answer on the Atlassian Community: Rovo works from whatever content the user can open, and it does not reliably pick the right version when pages disagree ([thread](https://community.atlassian.com/forums/Rovo-questions/How-does-Rovo-handle-conflicting-or-incomplete-information/qaa-p/3268873)). The other answers there suggest archiving old pages or finding duplicates, which doesn't say which value is right.

The name comes from auditing, where checking each figure in a report against its source is called tying out. Tie-Out does that for the dates, owners and statuses written on Confluence pages.

I also wanted to know how often pages and Jira disagree, so I ran Tie-Out's engine over public Apache data. On 609 Apache Flink design pages, Tie-Out flags 71 of the 288 facts it could check (24.7%). In 24 of them the page names one release and Jira another, and in 41 the page names a release where Jira has no fix version. The other 6 are 4 version-naming differences, 1 status and 1 case where Tie-Out misread the page, so in 70 of the 71 the page and Jira really do differ, though not always because the page is wrong. On 72 Apache Kafka release plans, none of the 100 checkable facts disagree. These pages state releases and statuses, so this measures those two fields; due dates and owners are covered by the tests and the demo site, not by this data. The scripts, the raw results and the limits are in the repository (`docs/evidence`), with the Rovo runs in `docs/evidence/rovo-summaries.md`.

## What it does

Tie-Out reads the due date, owner, status and fix version that a Confluence page states next to a Jira work item: in a table row, in a page-properties table, or in a sentence that names one work item. Priority is read from tables only. It compares each with Jira and marks it as matching, out of date, or not checked, with the reason.

A badge under the page title shows the result, for example "Tie-Out: 3 out of date", and a banner appears while anything is out of date. Clicking the badge opens the report: what the page says, what Jira says, and, from the Jira change history, when the page stopped being right and who made the change ("True until Nov 20, 2026 · changed by Jiyoung Park").

An out-of-date row has a button such as `Write "Dec 17"`. It rewrites that cell or word in the author's own date style and saves a new page version; only that text changes in the page body. "Update from Jira" in the banner does all of them at once. A fact Tie-Out cannot rewrite safely is marked "edit by hand" instead.

When a work item changes in Jira, an event re-checks only the pages that quote it. On the demo site I timed this twice: the pages were checked again 5 and 8 seconds after the change. In Jira, a panel on the work item lists the pages that quote it and what each one now gets wrong.

For agents, the Tie-Out Rovo agent and its `verify-before-publish` skill check a draft before it is sent and correct it. The same check is available as three MCP tools through `rovo:mcp`: `verify-claims`, `check-page` and `get-fact`. Custom agents in Rovo Studio can use them, and outside MCP clients can too once an admin turns that on.

When a page is out of date, Tie-Out asks Teamwork Graph who owns the page and which pages it links to, so you can see who should fix it and where the same fact may be repeated.

When every column of a status table is one Tie-Out understands (work item, summary, owner, due date, status, fix version, priority), the report offers "Make this table live". After one more confirmation it replaces the table with a Jira table, the Confluence Jira macro, which shows Jira's current values to everyone who can open Jira. Rows are then sorted by work item key. A table with any other column, such as Notes, is left alone, and the report says which column is in the way.

Some pages are meant to stay as they were written, such as a design record. A page with the label `tieout-ignore` gets no badge count or banner, starting from its next check. The report can still be opened by hand.

## How it differs from what teams use today

- Stale-page tools flag a page by its age or by how often it is viewed. Tie-Out checks the values on the page against Jira, so a page edited yesterday can be flagged and a page from 2022 can pass.
- Change-review tools react when a linked work item changes. Tie-Out compares the page with Jira as it is now, whether or not anything changed recently, which is how it found disagreements on the Apache pages that are years old. It can also correct the cell or make the table live.
- Rovo finds the right value if someone asks about one work item, but only someone who already suspects a problem will ask. A prompt can tell an agent to check; Tie-Out gives it a tool that returns the same answer every time, and puts the same result on the page for people.

## How I built it

Everything runs on Forge, and Tie-Out has no backend of its own.

The engine reads the page as ADF and takes a fact only in the three places listed above, where it is clear which work item the fact is about. It normalises how people write ("Dec 3", "3 Dec 2026", "2026-12-03", "12월 3일", first names, "WIP", "shipped") and compares the result with the Jira field. No language model decides a verdict, so the same page always gets the same answer.

Modules: `confluence:contentBylineItem` with dynamic properties, `confluence:pageBanner`, `confluence:globalPage`, `jira:issuePanel`, Jira and Confluence product event triggers, a scheduled trigger, `rovo:agent`, `rovo:skill`, three `action` modules and `rovo:mcp`, all in UI Kit.

The report, the Jira panel and the tools read Jira and Confluence as the person using them. The badge works differently. Its count is worked out in the background with the app's access and is shown to everyone who can read the page. For that reason it leaves out facts about work items that have an issue security level or that the app cannot read. In Forge storage Tie-Out keeps page ids and titles, counts and work item keys, never field values.

There are 106 automated tests. They cover the engine and the UI states, and they run the Forge handlers against an in-memory stand-in for the Jira and Confluence REST APIs.

## Challenges I ran into

Most of my time went into deciding which text to skip. "PAY-12 was fixed by Alice on Dec 3" contains a key, a name and a date, and it states no due date. A date counts only with a cue such as "due" or "ships". A row that names two work items is skipped. "UTF-8" looks like a work item key and is not one.

On real pages I found mistakes my tests had missed. On the Apache pages, `FLINK-2.4` was read as work item FLINK-2, template slots such as `<Flink Version>` were read as facts, and words in a release cell were compared as if they were a version. After that I took each fact the pages had right, changed the Jira value under it in a copy of Jira's answers, and checked again. Tie-Out missed 16 of 320 (the old rule counted three real disagreements as matches, hence 320 rather than 317), because `ml-2.0.0` and `ml-2.1.0` share the word "ml" and that was enough to count as the same release. I added a test for each of these mistakes.

That test also exposed a bug in my measurement script. It cached each batch of Jira answers in a file named after the first work item and the batch size. After the rules changed, some batches were answered from an old file, and work items that exist were counted as not found. My first figure for the Flink pages was 63 of 268; with the bug fixed and the version rule corrected it is 71 of 288. The repository describes both changes.

So that a correction changes only one cell, Tie-Out records where each fact sits in the ADF tree. When you press the button it reads the page again, checks it again, and writes only into the span where it found the fact. A fact whose words carry different formatting, such as a bold month next to a plain day, is marked "edit by hand".

## Accomplishments that I'm proud of

- With the version rule fixed, I changed the Jira value under each of the 317 facts on the Apache pages that were right, in a copy of Jira's answers. Tie-Out marked 316 of them out of date. In a second pass I made only cosmetic changes, under the 302 of those facts where one applied, such as `1.18` to `1.18.0` or renaming a status within its category. It raised no alarm on any of them.
- I kept one data set back while tuning: 1,380 Apache Kafka design pages (KIPs). They are mostly prose, so Tie-Out found only 23 facts it could check there, and flagged 5. Reading each against the page, 3 are real disagreements, 1 is a misreading (a ZooKeeper version in the same sentence as a Kafka work item) and 1 is debatable: the page says "ongoing" while Jira says "Open", which Apache projects use for active work. I left the misreading unfixed, because changing the rules after seeing these pages would mean they were no longer held out. The details are in `docs/evidence`.
- An outside MCP client I wrote with only the Python standard library connected to the tools through Atlassian's OAuth consent (details in the MCP bonus note).

## What I learned

The Rovo test showed me that an agent needs the check most on a summary of a page, before it's sent. The `verify-before-publish` skill runs that check, and the agent comparison above is the result.

I learned more from measuring on public data than I would have from another feature.

## What's next for Tie-Out

- Counts and roll-ups such as "17 of 23 done", recomputed from a JQL query.
- Sentence rules that can tell whose version a number is, the case the held-out pages exposed.
- Custom fields, and Jira Product Discovery and Goals as sources.
- Making a single sentence live, not only a whole table.
- A weekly note to page owners, using the owner relationship from Teamwork Graph.

## Links

- Source: https://github.com/ym0506/tieout
- Measurement: https://github.com/ym0506/tieout/tree/main/docs/evidence
- Privacy policy: https://github.com/ym0506/tieout/blob/main/PRIVACY.md

## Built with

forge, atlassian, jira, confluence, rovo, teamwork-graph, mcp, javascript, react

---

## How the project meets the technology requirement

Tie-Out is a Forge app (`manifest.yml`, runtime `nodejs24.x`) installed in Confluence and connected to Jira on the same site. It uses Confluence and Jira UI modules, Jira and Confluence product events, the Jira and Confluence REST APIs, Forge storage, Rovo (`rovo:agent`, `rovo:skill`, `action`, `rovo:mcp`) and the Teamwork Graph API. The full module list is under "How I built it".

## Bonus prize notes

**Best Agents (Rovo).** The app ships a `rovo:agent` named Tie-Out, a reusable `rovo:skill` named `verify-before-publish`, and three `action` modules that other agents can call as tools. Given a draft status update, the agent calls `verify-claims`, replaces each out-of-date fact with the Jira value and says what it changed.

**Best app with Atlassian MCP.** A `rovo:mcp` module named Tie-Out exposes `verify-claims` (check a draft before it is published), `check-page` (check a Confluence page by id or URL) and `get-fact` (the current due date, owner, status, fix versions and priority of a work item). The repository also has an open skill file, `skills/verify-before-publish/SKILL.md`, that tells any agent how to use them. Custom agents in Rovo Studio can add the tools directly. Outside MCP clients connect to `https://mcp.atlassian.com/forge/472dda99-d578-4070-b2ab-05a2797cf96b` after a site admin turns the tools on. I tested this on 28 November with a small client in the repository (`scripts/mcp-check.py`): OAuth 2.1 with PKCE through Atlassian's consent screen, then `tools/list` and calls to `get-fact` and `verify-claims`. Every tool reads Jira and Confluence with the calling user's permissions.

**Best apps with Teamwork Graph integration.** When a page is out of date, Tie-Out calls the Teamwork Graph API (`confluencePageOwners`, `confluencePageLinkedConfluencePages`) to show who owns the page and which linked pages may repeat the same fact, each with its own Tie-Out count. Scopes: `read:graph:page:confluence`, `read:graph:user:atlassian`.
