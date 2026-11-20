# Demo video script (target 4:30, hard limit 5:00)

Rules that apply: under 5 minutes, public on YouTube, English (or English subtitles), shows the app working,
no third-party logos or copyrighted music. For the MCP part use Rovo Studio, so no outside product's logo is on screen.

Record at 1920×1080, browser zoom 110%, a clean demo site, notifications off.
Prepare beforehand: the sample page created and one fact already fixed, one Jira work item open in a second tab.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:20 | A Confluence status page. Zoom on one row: smart link `PAY-12` with a live status lozenge, next to it "Dec 3" and "Minsu". Then the Jira work item: due Dec 17, assignee Jiyoung. | "This page says PAY-12 ships December 3rd. Jira says the 17th, and has for two weeks. The status lozenge is live, so the page looks current. The date and the owner next to it are just text. Nobody noticed." |
| 0:20–0:40 | Title card: "Tie-Out — every fact on the page, tied to Jira." Then the Apache numbers on one slide: 609 pages, 268 facts, 63 disagree. | "Auditors tie every figure in a report back to its source. Tie-Out does that for team pages. I ran it on six hundred public Apache design pages: nearly one checkable fact in four disagreed with Jira." |
| 0:40–1:25 | Confluence → Apps → Tie-Out → Create sample page → open it. Badge "3 out of date", banner. Click the badge: the report. Point at page says / Jira says / "True until…". | "On your own site it takes a minute. Tie-Out builds a status page from your work items, with two facts out of date on purpose. Under the title: three out of date. For each fact you see what the page says, what Jira says, and when it stopped being true and who changed it." |
| 1:25–1:50 | Click `Write "Dec 17"`. Reload. The one cell changed. Open page history: new version, message "Tie-Out: synced 1 fact with Jira". | "One click rewrites that cell, in the style the author used, as a new page version. Nothing else is touched." |
| 1:50–2:35 | Second tab: Jira, change the due date of another work item. Back to the page, reload: badge count went up, report shows the new row. Then the Jira panel on that work item. | "Now the part that matters. I change a due date in Jira. A Jira event re-checks only the pages that quote this work item. The page knows within seconds. And in Jira, the work item shows which pages quote it and which are now wrong." |
| 2:35–3:20 | Rovo Chat with the Tie-Out agent. Paste a short draft update with one wrong date. The agent's answer with the correction. | "People are not the only ones who read pages. Before an agent sends a status update, the Tie-Out agent checks it: this date is out of date, here is the current one, changed on November 6th. It corrects the draft and says what it changed." |
| 3:20–3:50 | Rovo Studio: a custom agent with the three Tie-Out tools listed; run `verify-claims`. | "The same three tools are exposed over MCP, so any agent in Rovo Studio, or an outside MCP client, can verify before it writes." |
| 3:50–4:10 | The report on a drifted page, section "Who and what else is affected (from Teamwork Graph)". | "When a page has drifted, Teamwork Graph tells Tie-Out who owns it and which linked pages may repeat the same fact." |
| 4:10–4:30 | Slide: "Rules, not a model · your permissions · counts only in storage · runs on Forge". Then the three-state legend: Matches / Out of date / Not checked. | "Verdicts come from rules, not a model, so the same page always gets the same answer. Reports use your own permissions. When Tie-Out can't tell, it says so. Context is only useful while it's true. Tie-Out tells you when it stops." |

## Shots to capture separately

- Page history showing the new version and its message.
- The "Not checked" row with its reason (write `early Q1` in a Due cell).
- Dashboard after a scan, with a few pages listed.

## Thumbnail

Left half: "Page says Dec 3". Right half: "Jira says Dec 17". Small caption: Tie-Out.
