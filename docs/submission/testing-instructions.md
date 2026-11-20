# Testing instructions for judges

Installation link: `<paste the link from the Forge developer console>`

## What you need

- An Atlassian Cloud site with **Confluence and Jira** (the Codegeist demo site works as is).
- **Rovo enabled** on the site, for the agent and MCP tools. Everything else works without Rovo.
- You install as a site admin. The Teamwork Graph scopes need an organization admin to approve; if they are not granted the app still works and simply leaves out the "owner and linked pages" section.

## Install (about 2 minutes)

1. Open the installation link, choose your site, choose **Confluence**, and approve the scopes.
2. Open the installation link again (or go to *Atlassian Administration → Apps → your site → Connected apps → Tie-Out*) and connect **Jira** on the same site.

The first time you open a Tie-Out screen, Atlassian asks you to **Allow access**. This is what lets the report use your own permissions.

## See it work on your own data (about 3 minutes)

1. In Confluence, open **Apps → Tie-Out**.
2. Under *Try it on your own data*, pick a space and press **Create sample page**. Tie-Out builds a status page from your most recent Jira work items. Two facts are out of date on purpose and the page says which.
3. Open the sample page. Under the title you see **Tie-Out: 3 out of date** (the due date is written twice), and a banner at the top.
4. Click the badge. The report lists what the page says, what Jira says, and the result for each fact.
5. Press **Write "…"** on one row, then **Reload the page**. That one cell changed; the page history shows a new version by you.

## The part that matters: change Jira, watch the page

1. In Jira, open one of the work items on the sample page and change its **due date** (or assignee, or status).
2. Go back to the Confluence page and reload. Within a few seconds of the change the badge count has gone up and the report shows the new disagreement, with "True until <today> · changed by <you>".
3. Open that work item in Jira. The **Tie-Out** panel lists the page and what it now gets wrong.

No sample needed: any page of yours works. Write a table with columns `Work item | Owner | Due | Status`, or a sentence such as `KEY-1 ships Dec 3, owner: Alice.`, and Tie-Out reads it.

## Existing pages

**Apps → Tie-Out → Scan pages** indexes pages that existed before the install, 20 at a time. New and edited pages are indexed automatically.

## Rovo agent

Open Rovo Chat, choose the **Tie-Out** agent, and try:

- On the sample page: `Is this page still accurate?`
- Anywhere: `Check this before I send it: KEY-1 ships Dec 3 and is owned by Alice. KEY-2 is done.` (use two of your own keys)

The agent calls `verify-claims`, corrects what is out of date, and tells you what it changed.

## MCP tools

In **Rovo Studio**, create an agent and add the **Tie-Out** tools (`verify-claims`, `check-page`, `get-fact`).

For a third-party MCP client: an admin enables the tools under *Atlassian Administration → Apps → your site → Connected apps → Tie-Out*, then the client connects to `https://mcp.atlassian.com/forge/<appId>` and approves access for the site.

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
