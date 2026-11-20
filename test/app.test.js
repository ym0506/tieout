// End-to-end tests of the Forge handlers against an in-memory site:
// resolvers, product events, the byline badge and the Rovo/MCP actions.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSite } from './fake-site.js';
import {
  doc, p, card, cell, th, row, table,
} from './helpers.js';

const fake = createFakeSite();

vi.mock('@forge/api', () => ({ default: fake.api, route: fake.route, ...fake.api }));
vi.mock('@forge/kvs', () => ({ kvs: fake.kvs, WhereConditions: fake.WhereConditions }));
vi.mock('@forge/resolver', () => ({
  default: class {
    constructor() { this.fns = {}; }
    define(name, fn) { this.fns[name] = fn; }
    getDefinitions() { return this.fns; }
  },
}));

const app = await import('../src/index.js');
const { site } = fake;

const ctx = { cloudId: 'cloud-1', siteUrl: 'https://acme.atlassian.net' };
const onPage = (pageId, payload = {}) => ({ payload, context: { ...ctx, extension: { content: { id: pageId } } } });
const call = (name, req) => app.resolver[name](req);

const statusPage = () => doc(
  p('Weekly status'),
  table(
    row(th('Work item'), th('Owner'), th('Due'), th('Status')),
    row(cell(card('PAY-12')), cell('Minsu Kim'), cell('Dec 3'), cell('In Progress')),
    row(cell(card('PAY-13')), cell('Jiyoung Park'), cell('Dec 17'), cell('In Progress')),
  ),
  p('PAY-12 ships Dec 3.'),
);

beforeEach(() => {
  site.issues = {};
  site.changelogs = {};
  site.pages = {};
  site.kv.clear();
  site.calls.length = 0;
  site.hiddenFromUser.clear();
  site.twgAvailable = true;
  site.graph = { owners: ['acc-owner'], linked: [] };
  site.addIssue('PAY-12');
  site.addIssue('PAY-13');
  site.changelogs['PAY-12'] = [
    { created: '2026-11-06T09:00:00.000+0000', author: { displayName: 'Jiyoung Park' }, items: [{ field: 'duedate', from: '2026-12-03', fromString: '2026-12-03 00:00:00.0', to: '2026-12-17', toString: '2026-12-17 00:00:00.0' }] },
    { created: '2026-11-02T09:00:00.000+0000', author: { displayName: 'Lead' }, items: [{ field: 'assignee', from: 'acc-minsu', fromString: 'Minsu Kim', to: 'acc-jiyoung', toString: 'Jiyoung Park' }] },
  ];
  site.addPage('1001', 'Payments status', statusPage());
});

describe('page report', () => {
  it('reports drift with the date the page stopped being true', async () => {
    const report = await call('getPageReport', onPage('1001'));
    expect(report.counts).toEqual({ total: 7, match: 4, drift: 3, unverifiable: 0 });
    const due = report.results.find((r) => r.id === 'PAY-12|due|1');
    expect(due).toMatchObject({ verdict: 'drift', raw: 'Dec 3', replacement: 'Dec 17', fixable: true });
    expect(due.history).toMatchObject({ wasTrueUntil: '2026-11-06T09:00:00.000+0000', changedBy: 'Jiyoung Park' });
    expect(report.page).toMatchObject({ id: '1001', title: 'Payments status' });
  });

  it('adds owner and linked pages from Teamwork Graph when something drifted', async () => {
    site.graph.linked = [{ id: '1002', title: 'Launch plan' }, { id: '1001', title: 'self' }];
    const report = await call('getPageReport', onPage('1001'));
    expect(report.context).toMatchObject({ source: 'teamwork-graph', owners: [{ accountId: 'acc-owner' }] });
    expect(report.context.linked.map((l) => l.id)).toEqual(['1002']);
  });

  it('still works when Teamwork Graph is unavailable', async () => {
    site.twgAvailable = false;
    const report = await call('getPageReport', onPage('1001'));
    expect(report.context).toBe(null);
    expect(report.counts.drift).toBe(3);
  });

  it('reads Jira and the page with the viewer’s permissions', async () => {
    site.hiddenFromUser.add('PAY-12');
    const report = await call('getPageReport', onPage('1001'));
    const hidden = report.results.filter((r) => r.issueKey === 'PAY-12');
    expect(hidden.every((r) => r.verdict === 'unverifiable' && r.actual === null)).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain('Jiyoung');
    expect(JSON.stringify(hidden)).not.toContain('2026');
    const userJira = site.calls.filter((c) => c.product === 'jira' && c.path.includes('bulkfetch')).map((c) => c.as);
    expect(userJira[0]).toBe('user');
  });

  it('stores counts and keys only, never field values', async () => {
    await call('getPageReport', onPage('1001'));
    const stored = JSON.parse(site.kv.get('page:1001'));
    expect(stored.counts).toEqual({ total: 7, match: 4, drift: 3, unverifiable: 0 });
    expect(stored.issueKeys.sort()).toEqual(['PAY-12', 'PAY-13']);
    const everything = [...site.kv.values()].join(' ');
    expect(everything).not.toContain('Jiyoung');
    expect(everything).not.toContain('2026-12-17');
    expect(JSON.parse(site.kv.get('issue:PAY-12'))).toEqual({ pageIds: ['1001'] });
  });

  it('returns a readable error for a page that does not exist', async () => {
    const res = await call('getPageReport', onPage('9999'));
    expect(res).toMatchObject({ error: true, status: 404 });
  });

  it('says so when a page has nothing to check', async () => {
    site.addPage('1003', 'Notes', doc(p('Lunch on Friday.')));
    const report = await call('getPageReport', onPage('1003'));
    expect(report.counts.total).toBe(0);
    expect(site.kv.has('page:1003')).toBe(false);
  });
});

describe('fixing the page', () => {
  it('rewrites one fact as the user and saves a new version', async () => {
    const res = await call('fixPage', onPage('1001', { claimIds: ['PAY-12|due|1'] }));
    expect(res).toMatchObject({ applied: ['PAY-12|due|1'], version: 2 });
    expect(site.pages['1001'].lastEditedAs).toBe('user');
    expect(site.pages['1001'].lastMessage).toBe('Tie-Out: synced 1 fact with Jira');
    const after = await call('getPageReport', onPage('1001'));
    expect(after.counts.drift).toBe(2);
  });

  it('rewrites everything at once', async () => {
    const res = await call('fixPage', onPage('1001', {}));
    expect(res.applied.sort()).toEqual(['PAY-12|assignee|1', 'PAY-12|due|1', 'PAY-12|due|2']);
    const after = await call('getPageReport', onPage('1001'));
    expect(after.counts).toEqual({ total: 7, match: 7, drift: 0, unverifiable: 0 });
    expect(JSON.parse(site.kv.get('page:1001')).counts.drift).toBe(0);
  });

  it('does not save when there is nothing to change', async () => {
    await call('fixPage', onPage('1001', {}));
    const again = await call('fixPage', onPage('1001', {}));
    expect(again).toMatchObject({ applied: [], version: 2 });
    expect(site.pages['1001'].version).toBe(2);
  });
});

describe('events', () => {
  it('re-checks only the pages that quote a changed work item', async () => {
    await call('fixPage', onPage('1001', {}));
    site.addPage('1002', 'Other', doc(p('PAY-13 is due Dec 17.')));
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:created:page', content: { id: '1002' } }, ctx);
    expect(JSON.parse(site.kv.get('page:1002')).counts).toMatchObject({ match: 1, drift: 0 });

    site.issues['PAY-12'].fields.duedate = '2027-01-09';
    site.calls.length = 0;
    await app.onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'PAY-12' } }, ctx);

    expect(JSON.parse(site.kv.get('page:1001')).counts.drift).toBe(2);
    const pagesRead = site.calls.filter((c) => c.product === 'confluence').map((c) => c.path);
    expect(pagesRead.every((path) => path.includes('/pages/1001'))).toBe(true);
    expect(site.calls.every((c) => c.as === 'app')).toBe(true);
  });

  it('updates the byline badge from stored counts', async () => {
    const payload = { extension: { content: { id: '1001' } } };
    expect(await app.bylineProperties(payload)).toMatchObject({ title: 'Tie-Out' });
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:updated:page', content: { id: '1001' } }, ctx);
    expect(await app.bylineProperties(payload)).toMatchObject({ title: 'Tie-Out: 3 out of date' });
    await call('fixPage', onPage('1001', {}));
    expect(await app.bylineProperties(payload)).toMatchObject({ title: 'Tie-Out: 7/7 tied' });
  });

  it('forgets a page that was deleted', async () => {
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:updated:page', content: { id: '1001' } }, ctx);
    site.pages['1001'].deleted = true;
    await app.onJiraIssueEvent({ issue: { key: 'PAY-12' } }, ctx);
    expect(site.kv.has('page:1001')).toBe(false);
    expect(site.kv.has('issue:PAY-12')).toBe(false);
  });

  it('drops a work item from the index when the page stops quoting it', async () => {
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:updated:page', content: { id: '1001' } }, ctx);
    site.pages['1001'].doc = doc(p('PAY-13 is due Dec 17.'));
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:updated:page', content: { id: '1001' } }, ctx);
    expect(site.kv.has('issue:PAY-12')).toBe(false);
    expect(JSON.parse(site.kv.get('issue:PAY-13'))).toEqual({ pageIds: ['1001'] });
  });

  it('ignores events without ids', async () => {
    await app.onJiraIssueEvent({}, ctx);
    await app.onConfluencePageEvent({}, ctx);
    expect(site.calls).toEqual([]);
  });
});

describe('Jira panel', () => {
  it('lists the pages quoting a work item with their verdicts', async () => {
    await app.onConfluencePageEvent({ eventType: 'avi:confluence:updated:page', content: { id: '1001' } }, ctx);
    const res = await call('getCitations', { payload: {}, context: { ...ctx, extension: { issue: { key: 'PAY-12' } } } });
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0]).toMatchObject({ id: '1001', title: 'Payments status', counts: { total: 4, match: 1, drift: 3, unverifiable: 0 } });
    expect(res.pages[0].claims.every((c) => c.issueKey === 'PAY-12')).toBe(true);
  });

  it('is empty for a work item nobody quotes', async () => {
    const res = await call('getCitations', { payload: { issueKey: 'PAY-99' }, context: ctx });
    expect(res).toMatchObject({ total: 0, pages: [] });
  });
});

describe('scan and dashboard', () => {
  it('indexes pages in batches and remembers where it stopped', async () => {
    for (let i = 0; i < 45; i += 1) site.addPage(String(2000 + i), `Page ${i}`, doc(p(i % 5 === 0 ? 'PAY-13 is due Dec 3.' : 'nothing here')));
    const first = await call('scan', { payload: { restart: true }, context: ctx });
    expect(first).toMatchObject({ scanned: 20, finished: false });
    const second = await call('scan', { payload: {}, context: ctx });
    const third = await call('scan', { payload: {}, context: ctx });
    expect(second.scanned + third.scanned).toBe(26);
    expect(third).toMatchObject({ finished: true, scanned: 6, totalScanned: 46 });

    const dash = await call('getDashboard', { payload: {}, context: ctx });
    expect(dash.totals).toMatchObject({ pages: 10, driftedPages: 10 });
    expect(dash.pages[0].counts.drift).toBeGreaterThan(0);
    expect(dash.scan).toMatchObject({ finished: true, scanned: 46 });
  });

  it('background scan runs to the end and then stops', async () => {
    for (let i = 0; i < 30; i += 1) site.addPage(String(3000 + i), `Page ${i}`, doc(p('PAY-12 is due Dec 17.')));
    await app.backgroundScan({}, ctx);
    expect(JSON.parse(site.kv.get('meta:scan'))).toMatchObject({ finished: true, scanned: 31 });
    site.calls.length = 0;
    await app.backgroundScan({}, ctx);
    expect(site.calls).toEqual([]);
  });
});

describe('sample page', () => {
  it('builds a page from the site’s own work items with exactly the announced drifts', async () => {
    site.addIssue('PAY-14', { duedate: null, assignee: null, status: { name: 'To Do', statusCategory: { key: 'new' } } });
    const res = await call('createSample', { payload: { spaceId: '100' }, context: ctx });
    expect(res.used).toEqual(['PAY-12', 'PAY-13', 'PAY-14']);
    expect(res.stale).toEqual(['PAY-12 due date', 'PAY-13 status']);
    const report = await call('getPageReport', onPage(res.page.id));
    const drifted = report.results.filter((r) => r.verdict === 'drift').map((r) => r.id).sort();
    expect(drifted).toEqual(['PAY-12|due|1', 'PAY-12|due|2', 'PAY-13|status|1']);
    expect(report.counts.unverifiable).toBe(0);
    expect(site.pages[res.page.id].doc.content[2].content[1].content[0].content[0].content[0])
      .toEqual({ type: 'inlineCard', attrs: { url: 'https://acme.atlassian.net/browse/PAY-12' } });
  });

  it('asks for a space and for at least one work item', async () => {
    expect(await call('createSample', { payload: {}, context: ctx })).toMatchObject({ error: true });
    site.issues = {};
    expect(await call('createSample', { payload: { spaceId: '100' }, context: ctx })).toMatchObject({ error: true });
  });

  it('lists spaces for the picker', async () => {
    expect(await call('listSpaces', { payload: {}, context: ctx })).toEqual({ spaces: [{ id: '100', key: 'TEAM', name: 'Team space', type: 'global' }] });
  });
});

describe('Rovo actions and MCP tools', () => {
  it('verify-claims corrects a draft before it is sent', async () => {
    const draft = '| Work item | Owner | Due |\n|---|---|---|\n| PAY-12 | Minsu | Dec 3 |\n\nPAY-13 is still in progress.';
    const res = await app.verifyClaimsAction({ text: draft }, ctx);
    expect(res.counts).toEqual({ total: 3, match: 1, drift: 2, unverifiable: 0 });
    expect(res.verdict).toMatch(/2 of 3 facts do not match Jira/);
    const due = res.results.find((r) => r.field === 'due');
    expect(due).toEqual({
      workItem: 'PAY-12', field: 'due', claimed: 'Dec 3', jira: 'Dec 17, 2026', verdict: 'drift',
      writeInstead: 'Dec 17', changed: 'true until 2026-11-06, changed by Jiyoung Park',
    });
  });

  it('verify-claims passes a correct draft and explains an empty one', async () => {
    const good = await app.verifyClaimsAction({ text: 'PAY-12 ships Dec 17, owner: Jiyoung Park.' }, ctx);
    expect(good.verdict).toBe('All 2 facts match Jira.');
    const none = await app.verifyClaimsAction({ text: 'Hello team.' }, ctx);
    expect(none.verdict).toMatch(/No checkable facts/);
    expect(await app.verifyClaimsAction({}, ctx)).toHaveProperty('error');
  });

  it('verify-claims respects the caller’s permissions', async () => {
    site.hiddenFromUser.add('PAY-12');
    const res = await app.verifyClaimsAction({ text: '[Payments](https://acme.atlassian.net/browse/PAY-12) ships Dec 3.' }, ctx);
    expect(res.results[0]).toMatchObject({ verdict: 'unverifiable', jira: null });
  });

  it('check-page accepts an id, a URL or the page in context', async () => {
    const byId = await app.checkPageAction({ page: '1001' }, ctx);
    expect(byId.counts.drift).toBe(3);
    const byUrl = await app.checkPageAction({ page: 'https://acme.atlassian.net/wiki/spaces/TEAM/pages/1001/Payments+status' }, ctx);
    expect(byUrl.page.id).toBe('1001');
    const inContext = await app.checkPageAction({}, { ...ctx, confluence: { contentId: '1001' } });
    expect(inContext.subject).toBe('page "Payments status"');
    const fromRovo = await app.checkPageAction({ context: { cloudId: 'cloud-1', confluence: { contentId: '1001', resourceType: 'page' } } }, {});
    expect(fromRovo.page.id).toBe('1001');
    expect(await app.checkPageAction({}, ctx)).toHaveProperty('error');
    expect((await app.checkPageAction({ page: '424242' }, ctx)).error).toMatch(/could not check page 424242/);
  });

  it('get-fact returns the current facts or says it cannot', async () => {
    const fact = await app.getFactAction({ workItem: 'pay-12' }, ctx);
    expect(fact).toMatchObject({ workItem: 'PAY-12', found: true, due: '2026-12-17', owner: 'Jiyoung Park', status: 'In Progress', fixVersions: ['2.4.0'] });
    const missing = await app.getFactAction({ workItem: 'NOPE-1' }, ctx);
    expect(missing).toMatchObject({ found: false });
    const viewedIssue = await app.getFactAction({ context: { cloudId: 'cloud-1', jira: { url: 'https://acme.atlassian.net/browse/PAY-13', resourceType: 'issue' } } }, {});
    expect(viewedIssue).toMatchObject({ workItem: 'PAY-13', found: true });
    expect(await app.getFactAction({}, ctx)).toHaveProperty('error');
  });
});
