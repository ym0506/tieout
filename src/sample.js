// Builds a sample status page from the site's own work items, so anyone
// installing Tie-Out sees it work on their data within a minute.
// Two cells are written out of date on purpose and the page says so.

import { humanDate, parseIso, toIso } from './engine/normalize.js';

const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const p = (...content) => ({ type: 'paragraph', content: content.filter(Boolean) });
const cell = (type, ...content) => ({ type, attrs: {}, content: [p(...content)] });
const card = (url) => ({ type: 'inlineCard', attrs: { url } });

function shiftDays(iso, days) {
  const d = parseIso(iso);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return toIso({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

const OTHER_STATUS = { new: 'In Progress', indeterminate: 'To Do', done: 'In Progress' };

/**
 * @param {object[]} issues reduced Jira issues (see engine/evaluate.js), newest first
 * @param {string} siteUrl e.g. https://acme.atlassian.net
 * @param {string} today ISO date used when a work item has no due date
 */
export function buildSamplePage(issues, siteUrl, today) {
  const rows = issues.slice(0, 6);
  const stale = [];

  const body = rows.map((issue, i) => {
    let due = issue.duedate ? humanDate(issue.duedate) : 'TBD';
    let owner = issue.assignee ? issue.assignee.displayName : 'Unassigned';
    let status = issue.status ? issue.status.name : 'To Do';

    if (i === 0) {
      // out-of-date due date
      due = humanDate(shiftDays(issue.duedate || today, -14));
      stale.push(`${issue.key} due date`);
    }
    if (i === 1) {
      // out-of-date status
      status = OTHER_STATUS[(issue.status && issue.status.category) || 'new'];
      stale.push(`${issue.key} status`);
    }
    return {
      type: 'tableRow',
      content: [
        cell('tableCell', card(`${siteUrl}/browse/${issue.key}`)),
        cell('tableCell', text(owner)),
        cell('tableCell', text(due)),
        cell('tableCell', text(status)),
      ],
    };
  });

  const first = rows[0];
  const doc = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'info' },
        content: [p(
          text('This page was created by Tie-Out from your own Jira work items. '),
          text(`Two facts are out of date on purpose (${stale.join(', ')}) so you can see a drift right away. `, [{ type: 'strong' }]),
          text('The due date is written twice, in the table and in the summary. '),
          text('Everything else matches Jira. Change a due date, owner or status in Jira and this page is re-checked within seconds.'),
        )],
      },
      { type: 'heading', attrs: { level: 2 }, content: [text('Weekly status')] },
      {
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: [
          {
            type: 'tableRow',
            content: ['Work item', 'Owner', 'Due', 'Status'].map((h) => cell('tableHeader', text(h, [{ type: 'strong' }]))),
          },
          ...body,
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [text('Summary')] },
      first ? p(
        card(`${siteUrl}/browse/${first.key}`),
        text(` is due ${humanDate(shiftDays(first.duedate || today, -14))}. `),
        rows[2] ? text(`${rows[2].key} is owned by ${rows[2].assignee ? rows[2].assignee.displayName : 'nobody yet'}.`) : null,
      ) : p(text('No work items yet.')),
    ],
  };
  return { doc, stale, used: rows.map((r) => r.key) };
}
