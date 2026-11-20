# Tie-Out privacy policy

Last updated: 20 November 2026

Tie-Out is a Forge app for Confluence and Jira. It runs entirely on Atlassian's Forge platform.
This page says what the app reads, what it stores, and what it never does.

## What Tie-Out reads

- **Confluence pages** on the site where it is installed: the page body, title, version and space, in order to find statements about Jira work items.
- **Jira work items** that those pages mention: summary, status, assignee, due date, fix versions, priority, and the change history of those fields.
- **Teamwork Graph**: the owners of a page and the pages it links to, when the organization admin has granted those scopes.

When a person opens a Tie-Out report, panel or tool, Jira and Confluence are read with that person's own permissions.
Background work (page and work item events, scans) runs as the app.

## What Tie-Out stores

Tie-Out stores a small index in Forge storage, which is hosted by Atlassian in the same location as your site's Confluence data:

- for each page that states facts about Jira work items: the page id, title, space id and version, the keys of the work items it mentions, how many facts match, are out of date or could not be checked, and when it was last checked;
- for each work item key: the ids of the pages that mention it;
- the progress of a site scan.

Tie-Out does **not** store field values (due dates, names, statuses), page content, account ids, email addresses or any other personal data.

## What Tie-Out never does

- It sends no data outside Atlassian. The app declares no external network access and has no backend of its own.
- It uses no analytics or tracking.
- It does not send your content to a language model. Verdicts are computed by rules inside the app. The Tie-Out Rovo agent and MCP tools are served by Atlassian Rovo under Atlassian's own terms.

## Changes Tie-Out makes

Tie-Out edits a Confluence page only when a person presses a button to do so. The edit is made as that person, is limited to the facts they chose, and is saved as a new page version that can be reverted from the page history.

## Deleting data

Uninstalling Tie-Out from Confluence removes it from Jira as well and deletes everything in its Forge storage.

## Contact

Questions about this policy: open an issue at the project's repository, or use the support contact shown on the app's installation page.
