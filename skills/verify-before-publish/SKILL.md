---
name: verify-before-publish
description: Check every fact about Jira work items (due date, owner, status, fix version, priority) against Jira before a status update, summary, release note or page is published or sent.
allowed-tools: verify-claims get-fact
---
# Verify before you publish

Use this skill whenever you are about to write, summarise or send text that states facts about Jira work items, for example a weekly status update, a launch plan, release notes or a reply that says when something ships or who owns it.

## Steps

1. Write the draft as usual. Keep each fact next to its work item key (for example `PAY-12 ships Dec 17, owner: Jiyoung Park`) or put the facts in a table with a column for the key and columns named Owner, Due and Status.
2. Call `verify-claims` with the whole draft in `text`.
3. Read `results`:
   - `match`: the fact agrees with Jira. Keep it.
   - `drift`: Jira says something else. Replace the fact with the value in `writeInstead`. If `changed` is present, you may tell the user when it changed and who changed it.
   - `unverifiable`: Tie-Out could not check it (`why` says so). Do not present it as confirmed. Either leave it out or say plainly that it was not checked.
4. If you changed anything, call `verify-claims` once more on the corrected draft and confirm that no result is `drift`.
5. When you need one fact you do not have, call `get-fact` with the work item key instead of recalling it from a page or from earlier in the conversation.

## Rules

- Jira is the system of record. A Confluence page, a chat message or your own earlier answer is not.
- Never invent a due date, owner or status. If `get-fact` returns `found: false`, say you could not read that work item.
- Tell the user what you corrected, in one short line per fact.
