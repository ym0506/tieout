// Tie-Out's use cases, written against four small adapters (jira, confluence,
// store, graph) so they can be exercised in tests without Forge.
//
// `as` is 'user' when a person is looking (their permissions decide what they
// may see) and 'app' for background work (events, scans), which stores only
// counts and keys, never field values.

import {
  extractClaims, evaluate, countVerdicts, applyFixes, textToAdf, explainDrift,
  findLiveTables, replaceWithJiraTable,
} from './engine/index.js';

const MAX_HISTORY_LOOKUPS = 8;
const MAX_PAGES_PER_ISSUE = 200;
const MAX_PARENT_DEPTH = 8;

/** A page with this label is left out of background checks, the badge and the banner. */
export const IGNORE_LABEL = 'tieout-ignore';

export function createTieOut({ jira, confluence, store, graph, now = () => new Date().toISOString() }) {
  async function verifyDoc(doc, { as, withHistory = false, keepUnknownTextKeys = false } = {}) {
    const ex = extractClaims(doc);
    const origins = Object.fromEntries(ex.mentions.map((m) => [m.key, m.origin]));
    const wanted = [...new Set(ex.claims.map((c) => c.issueKey))];
    const issues = wanted.length ? await jira.getIssues(wanted, as) : {};
    const results = evaluate(ex.claims, issues, { origins, keepUnknownTextKeys });

    if (withHistory) {
      const drifted = results.filter((r) => r.verdict === 'drift');
      const keys = [...new Set(drifted.map((r) => r.issueKey))].slice(0, MAX_HISTORY_LOOKUPS);
      const histories = {};
      await Promise.all(keys.map(async (k) => {
        try { histories[k] = await jira.getChangelog(k, as); } catch (e) { histories[k] = []; }
      }));
      for (const r of drifted) {
        if (histories[r.issueKey]) r.history = explainDrift(r, histories[r.issueKey]);
      }
    }
    const knownKeys = wanted.filter((k) => issues[k] && issues[k].found);
    return {
      results,
      counts: countVerdicts(results),
      issueKeys: knownKeys,
      restrictedKeys: knownKeys.filter((k) => issues[k].restricted),
      mentioned: ex.issueKeys.length,
    };
  }

  /**
   * Why a page is left out: 'self' when it carries the label, 'parent' when a page above it
   * does (so labelling a parent, or a space's home page, leaves out the whole tree), else null.
   */
  async function ignoreSource(pageId, labels, as, parentOf = undefined) {
    let own = labels;
    let parentKnown = parentOf;
    if (!own && confluence.getPageMeta) {
      // One request gives the page's labels and its parent.
      try {
        const meta = await confluence.getPageMeta(pageId, as);
        own = meta.labels;
        if (parentKnown === undefined) parentKnown = meta.parentId;
      } catch (e) { own = []; }
    } else if (!own && confluence.getLabels) {
      try { own = await confluence.getLabels(pageId, as); } catch (e) { own = []; }
    }
    if ((own || []).includes(IGNORE_LABEL)) return 'self';
    if (!confluence.getPageMeta) return null;
    // Walk up one parent at a time; each step reads the parent's labels with the page.
    let parentId = parentKnown;
    try {
      if (parentId === undefined) parentId = (await confluence.getPageMeta(pageId, as)).parentId;
      for (let depth = 0; parentId && depth < MAX_PARENT_DEPTH; depth += 1) {
        const parent = await confluence.getPageMeta(parentId, as);
        if (parent.labels.includes(IGNORE_LABEL)) return 'parent';
        parentId = parent.parentId;
      }
    } catch (e) { /* a page above that this caller cannot read */ }
    return null;
  }

  /**
   * Background bookkeeping: counts for the byline badge and the issue → pages index.
   * The badge is shown to everyone who can read the page, but these counts are worked out
   * with the app's access, so facts about work items under an issue security level, or that
   * the app cannot read, are left out of them. The report re-checks everything with the
   * viewer's own access.
   */
  async function record(page, as = 'app') {
    const report = await verifyDoc(page.doc, { as });
    const before = (await store.getPage(page.id)) || { issueKeys: [] };
    const source = (report.issueKeys.length || before.issueKeys.length || before.ignored)
      ? await ignoreSource(page.id, page.labels, as, page.parentId === undefined ? undefined : page.parentId) : null;
    const ignored = !!source;
    const issueKeys = ignored ? [] : report.issueKeys;
    // Facts about work items the app cannot read (r.actual is null) or that carry an issue
    // security level are left out, so the badge says nothing about them either way.
    const shown = ignored ? [] : report.results.filter((r) => r.actual !== null && !report.restrictedKeys.includes(r.issueKey));
    const summary = {
      id: page.id, title: page.title, spaceId: page.spaceId, version: page.version,
      counts: countVerdicts(shown),
      restricted: ignored ? 0 : report.results.length - shown.length,
      issueKeys, checkedAt: now(),
    };
    if (ignored) { summary.ignored = true; summary.ignoredFrom = source; }
    if (!issueKeys.length && !before.issueKeys.length && !ignored && !before.ignored) return summary;
    await store.setPage(page.id, summary);
    const gone = before.issueKeys.filter((k) => !issueKeys.includes(k));
    const added = issueKeys.filter((k) => !before.issueKeys.includes(k));
    for (const k of gone) {
      const entry = (await store.getIssue(k)) || { pageIds: [] };
      await store.setIssue(k, { pageIds: entry.pageIds.filter((id) => id !== page.id) });
    }
    for (const k of added) {
      const entry = (await store.getIssue(k)) || { pageIds: [] };
      if (!entry.pageIds.includes(page.id)) {
        await store.setIssue(k, { pageIds: [...entry.pageIds, page.id].slice(-MAX_PAGES_PER_ISSUE) });
      }
    }
    return summary;
  }

  /** Full report for the person looking at the page. */
  async function checkPage(pageId, { as = 'user', withContext = true } = {}) {
    const page = await confluence.getPage(pageId, as);
    const report = await verifyDoc(page.doc, { as, withHistory: true });
    let context = null;
    if (withContext && graph && report.counts.drift > 0) {
      try { context = await graph.pageContext(pageId, as); } catch (e) { context = null; }
      if (context && context.linked && context.linked.length) {
        const stored = await Promise.all(context.linked.map((l) => store.getPage(l.id)));
        context.linked = context.linked.map((l, i) => ({ ...l, counts: stored[i] ? stored[i].counts : null }));
      }
    }
    let summary = null;
    try { summary = await record(page, 'app'); } catch (e) { /* the report still stands without the index */ }
    return {
      page: { id: page.id, title: page.title, version: page.version, url: page.url },
      ...report,
      ignored: summary ? !!summary.ignored : (page.labels || []).includes(IGNORE_LABEL),
      ignoredFrom: summary && summary.ignored ? summary.ignoredFrom : null,
      liveTables: findLiveTables(page.doc).map(({ path, ...t }) => t),
      context,
      checkedAt: now(),
    };
  }

  /**
   * What the banner and badge show. A label added since the last check takes effect here,
   * because Confluence does not tell the app about labels without an extra permission.
   */
  async function pageSummary(pageId, { as = 'user' } = {}) {
    const stored = await store.getPage(pageId);
    if (stored && stored.counts && stored.counts.drift > 0 && confluence.getLabels) {
      if (await ignoreSource(pageId, null, as)) {
        const page = await confluence.getPage(pageId, 'app');
        return record(page, 'app');
      }
    }
    return stored || null;
  }

  /** Rewrite drifted facts on the page with what Jira says now. Runs as the person who clicked. */
  async function fixPage(pageId, { claimIds = null, as = 'user' } = {}) {
    const page = await confluence.getPage(pageId, as);
    const { results } = await verifyDoc(page.doc, { as });
    const chosen = results.filter((r) => r.verdict === 'drift' && (!claimIds || claimIds.includes(r.id)));
    const { doc, applied, skipped } = applyFixes(page.doc, chosen);
    if (!applied.length) return { applied, skipped, version: page.version };
    const message = `Tie-Out: synced ${applied.length} fact${applied.length === 1 ? '' : 's'} with Jira`;
    const updated = await confluence.updatePage(page, doc, message, as);
    try { await record({ ...page, doc, version: updated.version }, 'app'); } catch (e) { /* refreshed on the page event */ }
    return { applied, skipped, version: updated.version };
  }

  /**
   * Replace a typed status table with a live Jira table. The page is read again and the
   * table must still list the same work items, so a stale screen cannot overwrite an edit.
   */
  async function makeTableLive(pageId, { tableId, keys, as = 'user' } = {}) {
    const page = await confluence.getPage(pageId, as);
    const table = findLiveTables(page.doc).find((t) => t.id === tableId);
    if (!table) return { done: false, reason: 'The table is no longer on the page. Reload and try again.' };
    if (!table.eligible) return { done: false, reason: table.reason };
    if (keys && keys.join(',') !== table.keys.join(',')) {
      return { done: false, reason: 'The table changed since it was checked. Reload and try again.' };
    }
    const doc = replaceWithJiraTable(page.doc, table);
    const n = table.keys.length;
    const message = `Tie-Out: replaced a typed table of ${n} work item${n === 1 ? '' : 's'} with a live Jira table`;
    const updated = await confluence.updatePage(page, doc, message, as);
    try { await record({ ...page, doc, version: updated.version }, 'app'); } catch (e) { /* refreshed on the page event */ }
    return { done: true, version: updated.version, keys: table.keys };
  }

  /** A Jira work item changed: re-check only the pages that quote it. */
  async function onIssueChanged(issueKey) {
    const entry = await store.getIssue(issueKey);
    if (!entry || !entry.pageIds.length) return { pages: 0, drifted: [] };
    const drifted = [];
    for (const pageId of entry.pageIds) {
      try {
        const page = await confluence.getPage(pageId, 'app');
        const summary = await record(page, 'app');
        if (summary.counts.drift > 0) drifted.push(pageId);
      } catch (e) {
        if (e && e.status === 404) {
          await store.deletePage(pageId);
          await store.setIssue(issueKey, { pageIds: entry.pageIds.filter((id) => id !== pageId) });
        }
      }
    }
    return { pages: entry.pageIds.length, drifted };
  }

  async function onPageChanged(pageId) {
    const page = await confluence.getPage(pageId, 'app');
    return record(page, 'app');
  }

  async function onPageRemoved(pageId) {
    const before = await store.getPage(pageId);
    if (!before) return;
    for (const k of before.issueKeys) {
      const entry = (await store.getIssue(k)) || { pageIds: [] };
      await store.setIssue(k, { pageIds: entry.pageIds.filter((id) => id !== pageId) });
    }
    await store.deletePage(pageId);
  }

  /** Check a draft before it is published: the tool agents call. */
  async function verifyText(text, { as = 'user' } = {}) {
    // In a draft a key the caller cannot read is worth reporting, so unknown keys are kept.
    const report = await verifyDoc(textToAdf(text), { as, withHistory: true, keepUnknownTextKeys: true });
    return { ...report, checkedAt: now() };
  }

  /** The current facts for one work item, straight from Jira. */
  async function getFact(issueKey, { as = 'user' } = {}) {
    const key = String(issueKey || '').trim().toUpperCase();
    const issues = await jira.getIssues([key], as);
    const issue = issues[key];
    if (!issue || !issue.found) return { issueKey: key, found: false };
    return {
      issueKey: key,
      found: true,
      summary: issue.summary,
      due: issue.duedate,
      owner: issue.assignee ? issue.assignee.displayName : null,
      status: issue.status ? issue.status.name : null,
      statusCategory: issue.status ? issue.status.category : null,
      fixVersions: issue.fixVersions,
      priority: issue.priority,
      readAt: now(),
    };
  }

  /** For the Jira panel: which pages quote this work item, and are they still right? */
  async function citations(issueKey, { as = 'user', limit = 10 } = {}) {
    const entry = (await store.getIssue(issueKey)) || { pageIds: [] };
    const pages = [];
    for (const pageId of entry.pageIds.slice(-limit).reverse()) {
      try {
        const page = await confluence.getPage(pageId, as);
        const { results } = await verifyDoc(page.doc, { as, withHistory: false });
        const mine = results.filter((r) => r.issueKey === issueKey);
        pages.push({ id: page.id, title: page.title, url: page.url, counts: countVerdicts(mine), claims: mine });
      } catch (e) {
        // no access to this page, or it is gone: leave it out
      }
    }
    return { issueKey, total: entry.pageIds.length, pages };
  }

  /** Index a batch of pages. Call again with the returned cursor to continue. */
  async function scan({ cursor = null, limit = 25, as = 'app' } = {}) {
    const batch = await confluence.listPages({ cursor, limit }, as);
    let withFacts = 0;
    let drifted = 0;
    for (const page of batch.pages) {
      try {
        const summary = await record(page, 'app');
        if (summary.issueKeys.length) withFacts += 1;
        if (summary.counts.drift) drifted += 1;
      } catch (e) { /* one unreadable page must not stop the scan */ }
    }
    return { scanned: batch.pages.length, withFacts, drifted, cursor: batch.next || null };
  }

  async function dashboard() {
    const pages = (await store.listPages()).filter((p) => !p.ignored);
    pages.sort((a, b) => (b.counts.drift - a.counts.drift) || String(b.checkedAt).localeCompare(String(a.checkedAt)));
    const totals = pages.reduce((t, p) => ({
      pages: t.pages + 1,
      claims: t.claims + p.counts.total,
      match: t.match + p.counts.match,
      drift: t.drift + p.counts.drift,
      unverifiable: t.unverifiable + p.counts.unverifiable,
      driftedPages: t.driftedPages + (p.counts.drift ? 1 : 0),
    }), { pages: 0, claims: 0, match: 0, drift: 0, unverifiable: 0, driftedPages: 0 });
    return { pages, totals };
  }

  return {
    verifyDoc, record, checkPage, pageSummary, fixPage, makeTableLive, onIssueChanged, onPageChanged, onPageRemoved,
    verifyText, getFact, citations, scan, dashboard,
  };
}
