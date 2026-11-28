# Testing instructions for judges

Installation link: `<paste the link from the Forge developer console>`

## What you need

- An Atlassian Cloud site with **Confluence and Jira** (the Codegeist demo site works as is).
- **Rovo enabled** on the site, for the agent and MCP tools. Everything else works without Rovo.
- You install as a site admin. The Teamwork Graph scopes need an organization admin to approve. If they are not granted, the app still works and leaves out the "owner and linked pages" section.

## Install (about 2 minutes)

1. Open the installation link and press **Get app**.
2. In the dialog, choose your site. Confluence is selected already; tick **Jira** under "additional Atlassian apps" so the app can read work items.
3. Press **Install** and wait until both lines say "Installation successful".

The first time you open a Tie-Out screen, Atlassian asks you to **Allow access**. This lets the report read Jira and Confluence with your own permissions.

## See it work on your own data (about 3 minutes)

1. In Confluence, open **Apps → Tie-Out**.
2. Under *Try it on your own data*, pick a space and press **Create sample page**. Tie-Out builds a status page from recent Jira work items, preferring ones with a due date and an owner, and writes a few facts out of date on purpose. A note at the top of the page says exactly which ones and how many.
3. Open the sample page. The badge under the title shows the same number, for example **Tie-Out: 3 out of date**, and a banner appears at the top.
4. Click the badge. The report lists what the page says, what Jira says, and the result for each fact.
5. Press **Write "…"** on one row, then **Reload the page**. That one cell changed, and the page history shows a new version by you.

## Change Jira, then look at the page

1. In Jira, open one of the work items on the sample page and change its **due date**, assignee or status.
2. Go back to the Confluence page and reload. Once the Jira event has been processed (5 to 8 seconds in two tries on the demo site) the badge count goes up, and the report shows the new disagreement with "True until <today> · changed by <you>".
3. Open that work item in Jira. Under the title, press the apps button (**View app actions**) and choose **Tie-Out**. The panel lists the page and what it now gets wrong.

You don't need the sample: any page works. Write a table with the columns `Work item | Owner | Due | Status`, or a sentence such as `KEY-1 ships Dec 3, owner: Alice.`, and Tie-Out reads it.

## Make a table live

On the sample page, open the report (click the badge or press **Review** in the banner) and scroll to **Keep this table current**. Press **Make this table live**, then **Replace with a live Jira table**, and reload. The typed table is now a Jira table showing Jira's current values; the change is a new page version you can undo from the page history. The summary sentence under the table is still typed, so the badge keeps counting it.

Try it on a table that also has a column such as `Notes`: Tie-Out does not offer it and says which column is in the way.

## Existing pages

After the install Tie-Out reads the pages that already existed in the background, in hourly batches, until each page has been read once. **Apps → Tie-Out → Scan pages** runs the scan now. New and edited pages are indexed when they are saved.

## Keep a page out of it

Add the label `tieout-ignore` to a page, click the badge once to open the report, and reload. The badge now reads **Tie-Out: off**, no banner appears, and the report notes that background checks are off. To switch it back on, remove the label and open the report again.

## Rovo agent

Open Rovo Chat, choose the **Tie-Out** agent, and try:

- On the sample page: `Is this page still accurate?`
- Anywhere: `Check this before I send it: KEY-1 ships Dec 3 and is owned by Alice. KEY-2 is done.` (use two of your own keys)

The agent calls `verify-claims`, corrects what is out of date, and tells you what it changed.

## MCP tools

In **Rovo Studio**, create an agent and add the **Tie-Out** tools (`verify-claims`, `check-page`, `get-fact`).

For a third-party MCP client:

1. A site or org admin opens *Atlassian Administration → Apps → Sites → your site → Connected apps*, finds **Tie-Out**, opens **View app details**, and under **Tools** presses **Enable tools**.
2. Add `https://mcp.atlassian.com/forge/472dda99-d578-4070-b2ab-05a2797cf96b` as a remote MCP server in the client.
3. The client opens an Atlassian consent screen. Choose the site and approve.

The repository's `skills/verify-before-publish/SKILL.md` tells an agent how to use the three tools. `scripts/mcp-check.py` is a small client using only the Python standard library: it runs the consent flow on `127.0.0.1:8765`, lists the tools and calls `get-fact` and `verify-claims` (edit the work item key in the script to one of yours).

## Who sees what

The report, the Jira panel and the tools read Jira and Confluence with the permissions of the person using them. The badge count is worked out in the background and is shown to everyone who can read the page, so it leaves out facts about work items that have an issue security level or that the app cannot read. The report still checks facts about those work items for anyone who can open them.

## What Tie-Out reads, and what it leaves alone

| Reads | Leaves alone |
|---|---|
| Table rows with one work item and columns named Owner, Due, Status, Version or Priority | Rows that name two work items |
| Two-column "page properties" tables about one work item | Dates without a cue word ("we met on Dec 3") |
| Sentences or clauses naming exactly one work item | Past events ("was fixed on Dec 3"), "as of" dates |
| Smart links, links to a work item, plain keys | Code blocks; look-alike keys such as UTF-8 |

Anything it cannot decide is shown as **Not checked**, with the reason.

## Uninstall

Removing the app from Confluence removes it from Jira and deletes its stored counts.
