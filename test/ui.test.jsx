// Renders the UI Kit screens with stand-in components to make sure every
// state (loading, empty, drift, error) renders, and that the screens only
// use components and bridge methods that really exist in @forge/react.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import fs from 'node:fs';
import path from 'node:path';

const USED = [
  'Box', 'Inline', 'Stack', 'Text', 'Lozenge', 'Link', 'DynamicTable', 'LoadingButton', 'Strong', 'Heading',
  'SectionMessage', 'Spinner', 'Button', 'User', 'EmptyState', 'Modal', 'ModalTransition', 'ModalHeader',
  'ModalTitle', 'ModalBody', 'ModalFooter', 'Select',
];

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  view: { close: vi.fn() },
  router: { reload: vi.fn(), navigate: vi.fn(), open: vi.fn() },
}));

vi.mock('@forge/bridge', () => bridge);
vi.mock('@forge/react', async () => {
  const R = await import('react');
  const names = ['Box', 'Inline', 'Stack', 'Text', 'Lozenge', 'Link', 'LoadingButton', 'Strong', 'Heading',
    'SectionMessage', 'Spinner', 'Button', 'User', 'EmptyState', 'Modal', 'ModalTransition', 'ModalHeader',
    'ModalTitle', 'ModalBody', 'ModalFooter', 'Select'];
  const mod = {};
  for (const n of names) mod[n] = ({ children, ...props }) => R.createElement(n, props, children);
  // Tables render their cells so the test can read them.
  mod.DynamicTable = ({ head, rows, emptyView }) => R.createElement('DynamicTable', {},
    rows && rows.length
      ? rows.map((r) => R.createElement('Row', { key: r.key }, r.cells.map((c) => R.createElement('Cell', { key: c.key }, c.content))))
      : emptyView);
  mod.EmptyState = ({ header, description }) => R.createElement('EmptyState', {}, header, ' ', description);
  mod.SectionMessage = ({ title, children }) => R.createElement('SectionMessage', {}, title, ' ', children);
  mod.xcss = (s) => s;
  mod.default = { render: () => {} };
  return mod;
});

const { Report } = await import('../src/frontend/report.jsx');
const { Banner } = await import('../src/frontend/banner.jsx');
const { IssuePanel } = await import('../src/frontend/issue-panel.jsx');
const { Dashboard } = await import('../src/frontend/dashboard.jsx');

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf(node.children);
};
const find = (tree, type) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === type) out.push(n);
    walk(n.children);
  };
  walk(tree);
  return out;
};
async function render(el) {
  let r;
  await act(async () => { r = TestRenderer.create(el); });
  await act(async () => { await Promise.resolve(); });
  return r;
}

const drift = {
  id: 'PAY-12|due|1', issueKey: 'PAY-12', field: 'due', raw: 'Dec 3', verdict: 'drift', fixable: true, replacement: 'Dec 17',
  summary: 'Payments launch', actual: { display: 'Dec 17, 2026', iso: '2026-12-17' },
  history: { wasTrueUntil: '2026-11-06T09:00:00.000+0000', changedBy: 'Jiyoung Park' },
};
const match = { id: 'PAY-13|status|1', issueKey: 'PAY-13', field: 'status', raw: 'In Progress', verdict: 'match', summary: 'Refunds', actual: { display: 'In Progress' } };
const unknown = { id: 'SEC-1|due|1', issueKey: 'SEC-1', field: 'due', raw: 'Dec 9', verdict: 'unverifiable', reason: 'Work item not found, or you do not have access to it.', actual: null };
const report = (results, context = null) => ({
  page: { id: '1', title: 'Status' },
  results,
  counts: { total: results.length, match: results.filter((r) => r.verdict === 'match').length, drift: results.filter((r) => r.verdict === 'drift').length, unverifiable: results.filter((r) => r.verdict === 'unverifiable').length },
  context,
});

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.view.close.mockReset();
  bridge.router.reload.mockReset();
});

describe('the screens use only what @forge/react and @forge/bridge provide', () => {
  // The real packages look for the host bridge when loaded; a stub is enough to inspect their exports.
  const withBridge = () => { globalThis.window = globalThis.window || globalThis; globalThis.window.__bridge = { callBridge: async () => ({}) }; };

  it('every imported component exists in the installed @forge/react', async () => {
    withBridge();
    const real = await vi.importActual('@forge/react');
    const dir = path.resolve(__dirname, '../src/frontend');
    const imported = new Set();
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/import\s+(?:ForgeReconciler\s*,\s*)?\{([^}]+)\}\s+from\s+'@forge\/react'/g)) {
        m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => imported.add(n));
      }
    }
    expect(imported.size).toBeGreaterThan(15);
    const missing = [...imported].filter((n) => real[n] === undefined);
    expect(missing).toEqual([]);
    expect([...imported].filter((n) => n !== 'xcss' && !USED.includes(n))).toEqual([]);
  });

  it('the bridge has invoke, view.close and router.reload', async () => {
    withBridge();
    const real = await vi.importActual('@forge/bridge');
    expect(typeof real.invoke).toBe('function');
    expect(typeof real.view.close).toBe('function');
    expect(typeof real.router.reload).toBe('function');
  });
});

describe('Report', () => {
  it('shows what the page says, what Jira says, and when it changed', async () => {
    bridge.invoke.mockResolvedValue(report([match, drift, unknown]));
    const r = await render(<Report />);
    const text = textOf(r.toJSON());
    expect(text).toContain('1 out of date');
    expect(text).toContain('Dec 3');
    expect(text).toContain('Dec 17, 2026');
    expect(text).toContain('True until Nov 6, 2026 · changed by Jiyoung Park');
    expect(text).toContain('Write "Dec 17"');
    expect(text).toContain('you do not have access');
    const rows = find(r.toJSON(), 'Row');
    expect(rows).toHaveLength(3);
    expect(textOf(rows[0])).toContain('PAY-12'); // out-of-date facts first
  });

  it('fixes one fact, then offers to reload the page', async () => {
    bridge.invoke.mockImplementation(async (name) => {
      if (name === 'fixPage') return { applied: ['PAY-12|due|1'], skipped: [], version: 2 };
      return report([match, drift]);
    });
    const r = await render(<Report />);
    const button = find(r.toJSON(), 'LoadingButton')[0];
    expect(textOf(button)).toBe('Write "Dec 17"');
    await act(async () => { await r.root.findAllByType('LoadingButton')[0].props.onClick(); });
    expect(bridge.invoke).toHaveBeenCalledWith('fixPage', { claimIds: ['PAY-12|due|1'] });
    expect(textOf(r.toJSON())).toContain('1 fact updated on the page');
    await act(async () => { r.root.findAllByType('Button').find((b) => textOf(b.props.children) === 'Reload the page').props.onClick(); });
    expect(bridge.router.reload).toHaveBeenCalled();
  });

  it('offers "update all" when several facts drifted', async () => {
    bridge.invoke.mockResolvedValue(report([drift, { ...drift, id: 'PAY-12|due|2' }]));
    const r = await render(<Report />);
    expect(textOf(r.toJSON())).toContain('Update all 2 on the page');
    expect(textOf(r.toJSON())).toContain('2 facts on this page no longer match Jira');
  });

  it('shows owner and linked pages from Teamwork Graph', async () => {
    bridge.invoke.mockResolvedValue(report([drift], { owners: [{ accountId: 'acc-1' }], linked: [{ id: '9', title: 'Launch plan', counts: { drift: 2 } }] }));
    const r = await render(<Report />);
    const text = textOf(r.toJSON());
    expect(text).toContain('from Teamwork Graph');
    expect(text).toContain('Launch plan');
    expect(find(r.toJSON(), 'User')).toHaveLength(1);
  });

  it('explains an empty page and a failure', async () => {
    bridge.invoke.mockResolvedValue(report([]));
    expect(textOf((await render(<Report />)).toJSON())).toContain('No checkable facts on this page');
    bridge.invoke.mockResolvedValue({ error: true, message: 'Reading the page failed with 403' });
    expect(textOf((await render(<Report />)).toJSON())).toContain('Reading the page failed with 403');
    bridge.invoke.mockRejectedValue(new Error('network'));
    expect(textOf((await render(<Report />)).toJSON())).toContain('network');
  });
});

describe('Banner', () => {
  it('closes itself when nothing is out of date', async () => {
    bridge.invoke.mockResolvedValue({ counts: { total: 3, match: 3, drift: 0, unverifiable: 0 } });
    const r = await render(<Banner />);
    expect(r.toJSON()).toBe(null);
    expect(bridge.view.close).toHaveBeenCalled();
  });

  it('closes itself for a page that was never indexed', async () => {
    bridge.invoke.mockResolvedValue(null);
    await render(<Banner />);
    expect(bridge.view.close).toHaveBeenCalled();
  });

  it('warns and updates from Jira in one click', async () => {
    bridge.invoke.mockImplementation(async (name) => (name === 'fixPage'
      ? { applied: ['a', 'b'], skipped: [] }
      : { counts: { total: 5, match: 3, drift: 2, unverifiable: 0 } }));
    const r = await render(<Banner />);
    expect(textOf(r.toJSON())).toContain('2 facts on this page no longer match Jira.');
    expect(bridge.view.close).not.toHaveBeenCalled();
    await act(async () => { await r.root.findByType('LoadingButton').props.onClick(); });
    expect(bridge.invoke).toHaveBeenCalledWith('fixPage', { claimIds: null });
    expect(bridge.router.reload).toHaveBeenCalled();
  });

  it('opens the report when a fact needs editing by hand', async () => {
    bridge.invoke.mockImplementation(async (name) => {
      if (name === 'fixPage') return { applied: [], skipped: ['a'] };
      if (name === 'getPageReport') return report([{ ...drift, fixable: false }]);
      return { counts: { total: 1, match: 0, drift: 1, unverifiable: 0 } };
    });
    const r = await render(<Banner />);
    await act(async () => { await r.root.findByType('LoadingButton').props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    expect(find(r.toJSON(), 'Modal')).toHaveLength(1);
    expect(textOf(r.toJSON())).toContain('Edit by hand');
    expect(bridge.router.reload).not.toHaveBeenCalled();
  });
});

describe('Jira panel', () => {
  it('lists pages quoting the work item', async () => {
    bridge.invoke.mockResolvedValue({ issueKey: 'PAY-12', total: 2, pages: [
      { id: '1', title: 'Payments status', url: '/wiki/x', counts: { total: 2, match: 1, drift: 1, unverifiable: 0 }, claims: [drift] },
      { id: '2', title: 'Launch plan', url: null, counts: { total: 1, match: 1, drift: 0, unverifiable: 0 }, claims: [] },
    ] });
    const text = textOf((await render(<IssuePanel />)).toJSON());
    expect(text).toContain('Quoted on 2 pages.');
    expect(text).toContain('1 page says something this work item no longer says.');
    expect(text).toContain('Due date: page says "Dec 3", this work item says "Dec 17, 2026"');
  });

  it('explains when no page quotes it', async () => {
    bridge.invoke.mockResolvedValue({ issueKey: 'PAY-12', total: 0, pages: [] });
    expect(textOf((await render(<IssuePanel />)).toJSON())).toContain('No Confluence page that Tie-Out has indexed');
  });
});

describe('Dashboard', () => {
  const dash = (pages = [], scan = null) => ({
    pages,
    scan,
    totals: { pages: pages.length, claims: 7, match: 4, drift: 3, unverifiable: 0, driftedPages: pages.length },
  });
  const wire = (data, extra = {}) => bridge.invoke.mockImplementation(async (name, payload) => {
    if (name === 'getDashboard') return data;
    if (name === 'listSpaces') return { spaces: [{ id: '100', key: 'TEAM', name: 'Team space' }] };
    if (extra[name]) return extra[name](payload);
    return {};
  });

  it('renders the empty state with scan and sample tools', async () => {
    wire(dash());
    const text = textOf((await render(<Dashboard />)).toJSON());
    expect(text).toContain('No pages indexed yet');
    expect(text).toContain('Scan pages');
    expect(text).toContain('Create sample page');
  });

  it('lists indexed pages, most out of date first as given', async () => {
    wire(dash([{ id: '1001', title: 'Payments status', counts: { total: 7, match: 4, drift: 3, unverifiable: 0 }, issueKeys: ['PAY-12', 'PAY-13'], checkedAt: '2026-11-20T10:00:00Z' }]));
    const r = await render(<Dashboard />);
    const text = textOf(r.toJSON());
    expect(text).toContain('Payments status');
    expect(text).toContain('PAY-12, PAY-13');
    expect(text).toContain('Nov 20, 2026');
  });

  it('scans in batches until finished and reports the pages read', async () => {
    let n = 0;
    wire(dash(), { scan: () => { n += 1; return { scanned: n < 3 ? 20 : 6, finished: n >= 3 }; } });
    const r = await render(<Dashboard />);
    const scanButton = r.root.findAllByType('LoadingButton').find((b) => textOf(b.props.children) === 'Scan pages');
    await act(async () => { await scanButton.props.onClick(); });
    expect(n).toBe(3);
    expect(textOf(r.toJSON())).toContain('Scan complete: 46 pages read in this run.');
  });

  it('creates the sample page in the chosen space', async () => {
    const created = vi.fn(() => ({ page: { id: '5000', url: '/wiki/spaces/TEAM/pages/5000' }, stale: ['PAY-12 due date', 'PAY-13 status'], count: 3, used: ['PAY-12', 'PAY-13'] }));
    wire(dash(), { createSample: created });
    const r = await render(<Dashboard />);
    const button = r.root.findAllByType('LoadingButton').find((b) => textOf(b.props.children) === 'Create sample page');
    expect(button.props.isDisabled).toBe(false);
    await act(async () => { await button.props.onClick(); });
    expect(created).toHaveBeenCalledWith({ spaceId: '100' });
    expect(textOf(r.toJSON())).toContain('3 out of date on purpose: PAY-12 due date, PAY-13 status (the due date is written twice).');
  });

  it('shows a retry when loading fails', async () => {
    bridge.invoke.mockImplementation(async (name) => (name === 'getDashboard' ? { error: true, message: 'storage unavailable' } : { spaces: [] }));
    expect(textOf((await render(<Dashboard />)).toJSON())).toContain('storage unavailable');
  });
});
