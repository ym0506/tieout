// Entry points Forge calls: UI resolvers, product event triggers, the byline
// badge, and the Rovo actions that are also exposed as MCP tools.

import Resolver from '@forge/resolver';
import { createTieOut, IGNORE_LABEL } from '../core.js';
import { buildSamplePage } from '../sample.js';
import { keyFromUrl } from '../engine/index.js';
import { jira, confluence, store, makeGraph } from './adapters.js';

const tieout = (cloudId) => createTieOut({ jira, confluence, store, graph: makeGraph(cloudId) });

const pageIdOf = (req) => {
  const ext = (req.context && req.context.extension) || {};
  return (req.payload && req.payload.pageId) || (ext.content && ext.content.id) || null;
};

const failure = (e) => ({ error: true, status: e && e.status, message: (e && e.message) || 'Something went wrong.' });

/** Forge asks the user for consent by throwing a special error; that one must not be swallowed. */
const isConsent = (e) => e && (e.status === 401 || /NEEDS_AUTHENTICATION|authentication required/i.test(String(e.message || e.name)));

async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isConsent(e)) throw e;
    console.error('Tie-Out error', e && e.message);
    return failure(e);
  }
}

// ---- UI resolvers ----------------------------------------------------------

const resolver = new Resolver();

resolver.define('getPageReport', (req) => guarded(async () => {
  const pageId = pageIdOf(req);
  if (!pageId) return { error: true, message: 'No page in context.' };
  return tieout(req.context.cloudId).checkPage(pageId, { as: 'user' });
}));

resolver.define('getPageSummary', (req) => guarded(async () => {
  const pageId = pageIdOf(req);
  if (!pageId) return null;
  return tieout(req.context.cloudId).pageSummary(pageId, { as: 'user' });
}));

resolver.define('fixPage', (req) => guarded(async () => {
  const pageId = pageIdOf(req);
  const claimIds = (req.payload && req.payload.claimIds) || null;
  return tieout(req.context.cloudId).fixPage(pageId, { claimIds, as: 'user' });
}));

resolver.define('makeTableLive', (req) => guarded(async () => {
  const pageId = pageIdOf(req);
  const { tableId, keys } = req.payload || {};
  if (!pageId || !tableId) return { error: true, message: 'No table chosen.' };
  return tieout(req.context.cloudId).makeTableLive(pageId, { tableId, keys, as: 'user' });
}));

resolver.define('getCitations', (req) => guarded(async () => {
  const ext = (req.context && req.context.extension) || {};
  const issueKey = (req.payload && req.payload.issueKey) || (ext.issue && ext.issue.key);
  if (!issueKey) return { error: true, message: 'No work item in context.' };
  return tieout(req.context.cloudId).citations(issueKey, { as: 'user' });
}));

resolver.define('getDashboard', (req) => guarded(async () => {
  const data = await tieout(req.context.cloudId).dashboard();
  const scan = (await store.getMeta('scan')) || null;
  return { ...data, scan };
}));

resolver.define('scan', (req) => guarded(async () => {
  const restart = !!(req.payload && req.payload.restart);
  const state = restart ? null : await store.getMeta('scan');
  const result = await tieout(req.context.cloudId).scan({ cursor: state && state.cursor ? state.cursor : null, limit: 20, as: 'app' });
  const totalScanned = (state && !restart ? state.scanned || 0 : 0) + result.scanned;
  const finished = !result.cursor;
  await store.setMeta('scan', { cursor: result.cursor, scanned: totalScanned, finished, at: new Date().toISOString() });
  // `scanned` is this batch; `totalScanned` is the running total since the scan began.
  return { scanned: result.scanned, withFacts: result.withFacts, drifted: result.drifted, totalScanned, finished };
}));

resolver.define('listSpaces', () => guarded(async () => ({ spaces: await confluence.listSpaces('user') })));

resolver.define('createSample', (req) => guarded(async () => {
  const spaceId = req.payload && req.payload.spaceId;
  if (!spaceId) return { error: true, message: 'Choose a space first.' };
  const issues = await jira.sampleIssues(6, 'user');
  if (!issues.length) return { error: true, message: 'No Jira work items found. Create one in Jira, then try again.' };
  const siteUrl = (req.context && req.context.siteUrl) || '';
  const { doc, stale, count, used } = buildSamplePage(issues, siteUrl);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const page = await confluence.createPage({ spaceId, title: `Tie-Out sample status (${stamp})`, doc }, 'user');
  try { await tieout(req.context.cloudId).onPageChanged(page.id); } catch (e) { /* the page event will index it */ }
  return { page, stale, count, used };
}));

export const resolverHandler = resolver.getDefinitions();

// ---- byline badge ----------------------------------------------------------

/** Title of the item under the page title. Reads stored counts only, so it is fast and shows no field values. */
export async function bylineProperties(payload) {
  const pageId = payload && payload.extension && payload.extension.content && payload.extension.content.id;
  let summary = null;
  try { summary = pageId ? await store.getPage(pageId) : null; } catch (e) { summary = null; }
  if (summary && summary.ignored) {
    return { title: 'Tie-Out: off', tooltip: `Not checked in the background: this page has the label ${IGNORE_LABEL}` };
  }
  const restricted = summary && summary.restricted
    ? ` Facts about ${summary.restricted === 1 ? 'a work item' : 'work items'} with restricted access are not counted here; open the report to check them with your access.`
    : '';
  if (!summary || !summary.counts || !summary.counts.total) {
    return { title: 'Tie-Out', tooltip: `Check the facts on this page against Jira.${restricted}` };
  }
  const { drift, match, total } = summary.counts;
  if (drift > 0) {
    return { title: `Tie-Out: ${drift} out of date`, tooltip: `${drift} of ${total} facts on this page no longer match Jira.${restricted}` };
  }
  return { title: `Tie-Out: ${match}/${total} match`, tooltip: `Facts on this page that match Jira.${restricted}` };
}

// ---- product events --------------------------------------------------------

export async function onJiraIssueEvent(event, context) {
  const key = event && event.issue && event.issue.key;
  if (!key) return;
  const cloudId = context && context.cloudId;
  const result = await tieout(cloudId).onIssueChanged(key);
  if (result.pages) console.log(`Tie-Out: ${key} changed, re-checked ${result.pages} page(s), ${result.drifted.length} out of date`);
}

export async function onConfluencePageEvent(event, context) {
  const content = event && event.content;
  if (!content || !content.id) return;
  const cloudId = context && context.cloudId;
  const type = String(event.eventType || '');
  try {
    if (/:(trashed|deleted|archived):/.test(type)) await tieout(cloudId).onPageRemoved(String(content.id));
    else await tieout(cloudId).onPageChanged(String(content.id));
  } catch (e) {
    console.error('Tie-Out page event failed', e && e.message);
  }
}

// ---- Rovo actions / MCP tools ----------------------------------------------

const when = (iso) => (iso ? String(iso).slice(0, 10) : null);

function slim(r) {
  const out = {
    workItem: r.issueKey,
    field: r.field,
    claimed: r.raw,
    jira: r.actual ? r.actual.display : null,
    verdict: r.verdict,
  };
  if (r.verdict === 'drift') {
    out.writeInstead = r.replacement;
    if (r.history) {
      out.changed = r.history.wasTrueUntil
        ? `true until ${when(r.history.wasTrueUntil)}, changed by ${r.history.changedBy}`
        : `last changed ${when(r.history.changedAt)} by ${r.history.changedBy}`;
    }
  }
  if (r.verdict === 'unverifiable') out.why = r.reason;
  return out;
}

function toolReport(report, subject) {
  const { counts } = report;
  let verdict;
  if (!counts.total) verdict = 'No checkable facts found. Tie-Out checks due dates, owners, statuses, fix versions and priorities that are stated next to a work item key such as PAY-12.';
  else if (counts.drift) verdict = `${counts.drift} of ${counts.total} facts do not match Jira. Correct them before publishing.`;
  else if (counts.unverifiable) verdict = `${counts.match} facts match Jira; ${counts.unverifiable} could not be checked.`;
  else verdict = `All ${counts.total} facts match Jira.`;
  return {
    subject,
    verdict,
    counts,
    results: report.results.map(slim),
    checkedAt: report.checkedAt,
    source: 'Jira (system of record), read with the caller’s permissions',
  };
}

// Rovo passes what the user is looking at inside the payload: { context: { cloudId, jira: {...} | confluence: {...} } }.
const viewed = (payload) => (payload && payload.context) || {};
const cloudIdOf = (context, payload) => viewed(payload).cloudId || (context && context.cloudId) || null;

/** Action: verify-claims. Check a draft (plain text or Markdown) before it is published or sent. */
export async function verifyClaimsAction(payload, context) {
  const text = payload && (payload.text || payload.draft);
  if (!text || !String(text).trim()) return { error: 'Provide the draft text to check in `text`.' };
  try {
    const report = await tieout(cloudIdOf(context, payload)).verifyText(String(text), { as: 'user' });
    return toolReport(report, 'draft');
  } catch (e) {
    if (isConsent(e)) throw e;
    return { error: `Tie-Out could not check the draft: ${e.message}` };
  }
}

const pageIdFrom = (value) => {
  const s = String(value || '').trim();
  const m = /\/pages\/(\d+)/.exec(s) || /[?&]pageId=(\d+)/.exec(s) || /^(\d+)$/.exec(s);
  return m ? m[1] : null;
};

/** Action: check-page. Check an existing Confluence page by id or URL. */
export async function checkPageAction(payload, context) {
  const ctxPage = (viewed(payload).confluence && viewed(payload).confluence.contentId)
    || (context && context.confluence && context.confluence.contentId);
  const pageId = pageIdFrom(payload && (payload.page || payload.pageId)) || (ctxPage ? String(ctxPage) : null);
  if (!pageId) return { error: 'Provide a Confluence page id or page URL in `page`.' };
  try {
    const report = await tieout(cloudIdOf(context, payload)).checkPage(pageId, { as: 'user', withContext: false });
    return { ...toolReport(report, `page "${report.page.title}"`), page: report.page };
  } catch (e) {
    if (isConsent(e)) throw e;
    return { error: `Tie-Out could not check page ${pageId}: ${e.message}` };
  }
}

/** Action: get-fact. The current due date, owner, status, fix versions and priority of one work item. */
export async function getFactAction(payload, context) {
  const viewedIssue = viewed(payload).jira && keyFromUrl(viewed(payload).jira.url);
  const key = (payload && (payload.workItem || payload.issueKey)) || viewedIssue;
  if (!key) return { error: 'Provide a work item key such as PAY-12 in `workItem`.' };
  try {
    const fact = await tieout(cloudIdOf(context, payload)).getFact(key, { as: 'user' });
    if (!fact.found) return { workItem: fact.issueKey, found: false, note: 'Not found, or you do not have access. Do not state facts about it.' };
    return { ...fact, workItem: fact.issueKey, issueKey: undefined, source: 'Jira (system of record)' };
  } catch (e) {
    if (isConsent(e)) throw e;
    return { error: `Tie-Out could not read ${key}: ${e.message}` };
  }
}

export { toolReport, slim, pageIdFrom };

// ---- background indexing ---------------------------------------------------

const SCAN_BUDGET_MS = 18000;

/** Continue the site scan for a few batches. Used on install and by the hourly schedule until the scan is complete. */
export async function backgroundScan(event, context) {
  const cloudId = context && context.cloudId;
  const started = Date.now();
  let state = (await store.getMeta('scan')) || { cursor: null, scanned: 0, finished: false };
  if (state.finished) return;
  while (Date.now() - started < SCAN_BUDGET_MS) {
    const result = await tieout(cloudId).scan({ cursor: state.cursor, limit: 20, as: 'app' });
    state = { cursor: result.cursor, scanned: (state.scanned || 0) + result.scanned, finished: !result.cursor, at: new Date().toISOString() };
    await store.setMeta('scan', state);
    if (state.finished) break;
  }
  console.log(`Tie-Out: background scan at ${state.scanned} page(s), finished=${state.finished}`);
}
