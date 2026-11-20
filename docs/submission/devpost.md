# Devpost submission text

Category: **Apps for Business Teams**
Bonus prizes: **Best Agents (Rovo)**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**

---

## Project name

Tie-Out

## Tagline (max 200 characters)

Your pages say Dec 3. Jira says Dec 17. Tie-Out checks every fact a Confluence page states about a Jira work item, shows what went out of date, and lets agents verify before they write.

## Inspiration

Auditors do not trust a report until every figure in it has been traced back to its source. They call that tying out.

Team pages get no such check. A status page says "PAY-12 ships Dec 3, owner Minsu". Two weeks later Jira says Dec 17 and a different owner. Nobody edits the page. The smart link next to the sentence shows the live status, so the page looks current, while the date and the name beside it are plain text that never changes.

This year the theme is context. Everyone is feeding more context to people and to agents. I wanted to ask the question that comes first: is that context still true?

I measured it before building. On 609 public design pages of Apache Flink, 63 of the 268 facts I could check against the project's Jira disagreed with it (23.5%). In 19 of those (7.1%) the page names one release and Jira names another. Most of those pages were last edited two or more years ago. On Apache Kafka's release plans the answer was 0 of 100, which told me something just as important: the check has to stay quiet when the page is right. The script and the raw results are in the repository.

## What it does

Tie-Out finds every due date, owner, status, fix version and priority that a Confluence page states about a Jira work item, compares it with Jira, and gives one of three answers: **matches Jira**, **out of date**, or **not checked** with the reason.

- **On the page.** A badge under the title reads "Tie-Out: 2 out of date" or "7/7 tied". When something is out of date a banner appears. The report shows what the page says, what Jira says, and when it stopped being true ("True until Nov 6 · changed by Jiyoung Park").
- **One click to correct.** "Write Dec 17" rewrites that cell or that word in place, in the author's own date style, and saves a new page version. Nothing else on the page is touched.
- **The moment Jira changes.** A Jira event re-checks only the pages that quote the changed work item.
- **In Jira.** A panel on each work item lists the pages that quote it and which of them now say something it no longer says.
- **For agents, before they write.** The Tie-Out Rovo agent and its `verify-before-publish` skill check a draft and correct it. The same three tools (`verify-claims`, `check-page`, `get-fact`) are exposed through `rovo:mcp`, so custom agents in Rovo Studio and outside MCP clients can verify a status update before posting it.
- **Who else is affected.** When a page has drifted, Tie-Out asks Teamwork Graph for the page's owners and the pages it links to, so you know who should fix it and where the same fact may be repeated.

## How I built it

Everything runs on Forge. No data leaves Atlassian.

- **Rules, not a model.** The engine reads the page as ADF and takes a claim only when the text leaves no doubt which work item it is about: a table row with one work item, a two-column page-properties table, or a sentence naming exactly one work item. It normalises how people write ("Dec 3", "3 Dec 2026", "2026-12-03", "12월 3일", first names, "WIP", "shipped") and compares with the Jira field. No LLM decides a verdict, so the same page always gets the same answer.
- **Modules.** `confluence:contentBylineItem` with dynamic properties, `confluence:pageBanner`, `confluence:globalPage`, `jira:issuePanel`, product event triggers for Jira and Confluence, a scheduled trigger, `rovo:agent`, `rovo:skill`, three `action` modules and `rovo:mcp`. UI Kit throughout.
- **Permissions.** What a person sees is read from Jira and Confluence as that person. Background work stores only counts and work item keys in Forge storage, never field values.
- **Teamwork Graph.** Curated queries `confluencePageOwners` and `confluencePageLinkedConfluencePages` through `requestTeamworkGraph`. If the graph scopes are not granted the app still works; it just leaves that section out.
- **Tests.** 90 automated tests: the engine, the Forge handlers end to end against an in-memory Atlassian site, and every UI state.

## Challenges I ran into

- **Deciding what not to read.** "PAY-12 was fixed by Alice on Dec 3" contains a key, a name and a date and states no due date. A date only counts when the sentence looks forward or says "due". A row that names two work items is skipped. "UTF-8" looks like a work item key and is not one.
- **Real pages broke my rules.** Running on the Apache pages produced three kinds of false alarm: `FLINK-2.4` read as work item `FLINK-2`, unfilled template slots such as `<Flink Version>` read as claims, and words in a release cell compared as if they were a version. Each is fixed and has a test.
- **Fixing without damage.** A correction must change one word and leave the rest of the page byte-identical. Tie-Out records where each claim lives in the ADF tree, refuses the edit if the text changed since the check, and reports facts split across formatting as "edit by hand" instead of guessing.
- **Saying "I don't know".** "KIP Accepted" is not a Jira status. "early Q1" is not a date. 3/4 could be March or April. These are shown as "not checked" with the reason.

## Accomplishments that I'm proud of

- It found real disagreements on real pages, and stayed silent on 100 of 100 correct ones.
- The same check serves a person reading a page, a Rovo agent drafting an update, and an outside MCP client.
- It works on a fresh site within a minute: "Create sample page" builds a status page from your own work items, with two facts out of date on purpose and labelled as such.

## What I learned

- Context has a shelf life. The useful question about a page is not how old it is but whether what it says is still true, and for facts that live in Jira that question has an exact answer.
- A quiet tool earns trust. Most of the work went into the cases where Tie-Out says nothing.
- MCP changes where a check belongs. Cleaning up stale pages helps; stopping a wrong fact before an agent writes it helps more.

## What's next for Tie-Out

- Counts and roll-ups ("17 of 23 done") recomputed from a JQL query.
- Custom fields, and Jira Product Discovery and Goals as sources.
- Facts that span sentences.
- A weekly digest to page owners, using the owner relationship from Teamwork Graph.

## Built with

forge, atlassian, jira, confluence, rovo, teamwork-graph, mcp, javascript, react

---

## How the project meets the technology requirement

Tie-Out is a Forge app (`manifest.yml`, runtime `nodejs24.x`) installed in Confluence and connected to Jira on the same site. It uses Confluence modules (`confluence:contentBylineItem`, `confluence:pageBanner`, `confluence:globalPage`), a Jira module (`jira:issuePanel`), Jira and Confluence product events, the Jira and Confluence REST APIs, Forge storage, Rovo (`rovo:agent`, `rovo:skill`, `action`, `rovo:mcp`) and the Teamwork Graph API.

## Bonus prize notes

**Best Agents (Rovo).** The app ships a `rovo:agent` named Tie-Out, a reusable `rovo:skill` (`verify-before-publish`, with a `SKILL.md` that other agents can load) and three `action` modules that other agents can invoke as tools.

**Best app with Atlassian MCP.** A `rovo:mcp` module named Tie-Out exposes three tools: `verify-claims` (check a draft before it is published), `check-page` (check a Confluence page by id or URL) and `get-fact` (read the current due date, owner, status, fix versions and priority of a work item). They are available to custom agents in Rovo Studio, and to third-party MCP clients at `https://mcp.atlassian.com/forge/<appId>` once an admin enables external exposure. Every tool reads Jira and Confluence with the calling user's permissions.

**Best apps with Teamwork Graph integration.** When a page has drifted, Tie-Out calls the Teamwork Graph API (`confluencePageOwners`, `confluencePageLinkedConfluencePages`) to show who owns the page and which linked pages may repeat the same fact, with each linked page's own Tie-Out result. Scopes: `read:graph:page:confluence`, `read:graph:user:atlassian`.
