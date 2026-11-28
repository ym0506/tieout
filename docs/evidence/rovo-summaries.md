# Rovo on a page that disagrees with Jira

Manual runs on the Codegeist demo site, 27–28 November 2026. Rovo's answers vary from run to run; these are all the runs
made, not a selection. The site admin's account name is replaced with "(site admin)".

## The page

"Onboarding weekly status" is a copy of the sample page Tie-Out builds, with the note that says which facts are wrong on
purpose removed. Its first line reads "Status as of our Thursday sync. Ping the owner if something slips." Its table row for
MOBL-57 says owner Mitch Davis, due Nov 6, 2026, status To Do.

| Fact | Page | Jira at the time of the runs |
|---|---|---|
| MOBL-57 owner | Mitch Davis | (site admin), changed in Jira on 20 November |
| MOBL-57 due date | Nov 6, 2026 | none |

The due date was written wrong on purpose by the sample page. The owner changed in Jira after the page was written.
During timing tests on 28 November the owner was set to Mitch Davis and back within a minute; all runs below were made
with the owner as in the table.

## Runs

Each run is a fresh chat with the page attached as context.

| # | Agent | Request | What it said about MOBL-57 | Values used |
|---|---|---|---|---|
| 1 | Default Rovo | Summarise the Weekly status table on this page for my manager: what is due when, and who owns what? | "Mitch Davis owns 5 of the 6 items. Only one has a due date: MOBL-57, due Nov 6, 2026 ... so it's overdue." | Page |
| 2 | Default Rovo | same | Table row "MOBL-57 · Mitch Davis · Nov 6, 2026 (overdue)" | Page |
| 3 | Default Rovo | same | "only one has a due date: MOBL-57, which was due Nov 6, 2026 and is now three weeks overdue ... Mitch Davis owns five of the six items" | Page |
| 4 | Default Rovo | Who owns MOBL-57 and when is it due? | "Jira and your status page give different answers": Jira owner (site admin), no due date; page Mitch Davis, Nov 6 | Jira |
| 5 | Tie-Out agent | Summarise the Weekly status table on this page for my manager: what is due when, and who owns what? | Owner (site admin), due TBD; "Corrections made based on Jira: MOBL-57 owner corrected ... MOBL-57 due date corrected to TBD (no due date in Jira)" | Jira |
| 6 | Tie-Out agent | same | Owner (site admin), due TBD, same corrections listed | Jira |
| 7 | Tie-Out agent | same | Owner (site admin), due TBD, same corrections, and it also listed the other rows' TBD dates as "changed to TBD" although the page already said TBD | Jira |

Two more runs, for context:

- On the original sample page, which still carries the note saying two facts are out of date on purpose, default Rovo's
  summary went through "Checking current values in Jira" and used Jira's values. The note prompted it.
- With no page attached, "When is the Compliance work in the onboarding project due, and who owns it?" made Rovo search
  Jira directly; it picked a different work item (EO-5) and did not use the page.

## Reading it

Default Rovo used Jira when the question named one work item or when the page itself said something was out of date.
Asked to summarise an ordinary page, it used the page in 3 of 3 runs. The Tie-Out agent, whose instructions tell it to call
`verify-claims` before answering, used Jira in 3 of 3. This is a small number of runs on one page the author built.
