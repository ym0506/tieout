// Small builders for ADF fixtures and Jira issues used across tests.

export const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
export const link = (t, href) => text(t, [{ type: 'link', attrs: { href } }]);
export const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? text(c) : c)) });
export const card = (key) => ({ type: 'inlineCard', attrs: { url: `https://acme.atlassian.net/browse/${key}` } });
export const date = (iso) => ({ type: 'date', attrs: { timestamp: String(Date.parse(`${iso}T00:00:00Z`)) } });
export const mention = (id, name) => ({ type: 'mention', attrs: { id, text: `@${name}` } });
export const status = (label, color = 'neutral') => ({ type: 'status', attrs: { text: label, color, localId: 'x' } });
export const cell = (...content) => ({ type: 'tableCell', attrs: {}, content: [p(...content)] });
export const th = (label) => ({ type: 'tableHeader', attrs: {}, content: [p(label)] });
export const row = (...cells) => ({ type: 'tableRow', content: cells });
export const table = (...rows) => ({ type: 'table', attrs: {}, content: rows });
export const doc = (...content) => ({ type: 'doc', version: 1, content });

export const issue = (key, over = {}) => ({
  key,
  found: true,
  summary: `Summary of ${key}`,
  duedate: '2026-12-17',
  assignee: { accountId: 'acc-jiyoung', displayName: 'Jiyoung Park' },
  status: { name: 'In Progress', category: 'indeterminate' },
  fixVersions: ['2.4.0'],
  priority: 'High',
  ...over,
});

export const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));
