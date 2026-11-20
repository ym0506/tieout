// Compares extracted claims with the Jira facts and decides, per claim:
//   match        the page agrees with Jira
//   drift        the page says something Jira no longer says
//   unverifiable Tie-Out cannot tell (no access, vague wording, ambiguous date)

import {
  sameDate, sameName, compareStatus, versionMatches, humanDate, formatLike, toIso, clean,
} from './normalize.js';

/**
 * Shape every Jira issue is reduced to before comparing:
 * { key, found, duedate: 'YYYY-MM-DD'|null, assignee: {accountId, displayName}|null,
 *   status: {name, category}, fixVersions: string[], priority: string|null, summary }
 */
export function reduceIssue(raw) {
  const f = (raw && raw.fields) || {};
  return {
    key: raw.key,
    found: true,
    summary: f.summary || '',
    duedate: f.duedate || null,
    assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName || '' } : null,
    status: f.status ? { name: f.status.name, category: (f.status.statusCategory && f.status.statusCategory.key) || null } : null,
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    priority: f.priority ? f.priority.name : null,
  };
}

// Changelog items carry a `toString` field, which collides with Object.prototype.toString.
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function actualOf(field, issue) {
  switch (field) {
    case 'due': return { display: humanDate(issue.duedate), iso: issue.duedate };
    case 'assignee': return { display: issue.assignee ? issue.assignee.displayName : 'Unassigned', accountId: issue.assignee && issue.assignee.accountId };
    case 'status': return { display: issue.status ? issue.status.name : 'unknown', category: issue.status && issue.status.category };
    case 'fixVersion': return { display: issue.fixVersions.length ? issue.fixVersions.join(', ') : 'no fix version' };
    case 'priority': return { display: issue.priority || 'no priority' };
    default: return { display: '' };
  }
}

function judge(claim, issue) {
  const v = claim.value;
  switch (claim.field) {
    case 'due':
      if (v.ambiguous) return ['unverifiable', 'The date can be read two ways (day/month order).'];
      if (!issue.duedate) return ['drift', 'Jira has no due date for this work item.'];
      return sameDate(v, issue.duedate) ? ['match'] : ['drift'];
    case 'assignee': {
      if (v.nobody) return issue.assignee ? ['drift'] : ['match'];
      if (!issue.assignee) return ['drift', 'The work item is unassigned in Jira.'];
      if (v.accountIds.includes(issue.assignee.accountId)) return ['match'];
      if (v.names.some((n) => sameName(n, issue.assignee.displayName))) return ['match'];
      return ['drift'];
    }
    case 'status': {
      const r = compareStatus(v.text, issue.status);
      if (r === 'match') return ['match'];
      if (r === 'drift') return ['drift'];
      return ['unverifiable', 'This wording does not map to a Jira status.'];
    }
    case 'fixVersion':
      if (!issue.fixVersions.length) return ['drift', 'Jira has no fix version for this work item.'];
      return versionMatches(v.text, issue.fixVersions) ? ['match'] : ['drift'];
    case 'priority':
      if (!issue.priority) return ['unverifiable', 'Jira has no priority for this work item.'];
      return clean(v.text) === clean(issue.priority) ? ['match'] : ['drift'];
    default:
      return ['unverifiable', 'Unsupported field.'];
  }
}

/** What the page should say instead, written the way the author wrote it. */
export function replacementFor(claim, issue) {
  switch (claim.field) {
    case 'due': return issue.duedate ? formatLike(claim.value, issue.duedate) : 'TBD';
    case 'assignee': return issue.assignee ? issue.assignee.displayName : 'Unassigned';
    case 'status': return issue.status ? issue.status.name : claim.raw;
    case 'fixVersion': return issue.fixVersions.length ? issue.fixVersions.join(', ') : 'TBD';
    case 'priority': return issue.priority || claim.raw;
    default: return claim.raw;
  }
}

/**
 * @param {object[]} claims from extractClaims
 * @param {Record<string, object>} issues reduced issues by key; a missing key means "not found or no access"
 * @param {{origins?: Record<string,string>}} opts how each key was written (card, link, text)
 */
export function evaluate(claims, issues, opts = {}) {
  const origins = opts.origins || {};
  const results = [];
  for (const claim of claims) {
    const issue = issues[claim.issueKey];
    if (!issue || !issue.found) {
      // "UTF-8" style false keys: written as bare text and unknown to Jira → not a claim at all.
      if (origins[claim.issueKey] === 'text' && !opts.keepUnknownTextKeys) continue;
      results.push({ ...claim, verdict: 'unverifiable', reason: 'Work item not found, or you do not have access to it.', actual: null });
      continue;
    }
    if (claim.uncheckable) {
      results.push({ ...claim, verdict: 'unverifiable', reason: `"${claim.raw}" is ${claim.uncheckable}.`, actual: actualOf(claim.field, issue), summary: issue.summary });
      continue;
    }
    const [verdict, reason] = judge(claim, issue);
    const actual = actualOf(claim.field, issue);
    results.push({
      ...claim,
      verdict,
      reason: reason || (verdict === 'drift' ? `Page says "${claim.raw}", Jira says "${actual.display}".` : ''),
      actual,
      summary: issue.summary,
      replacement: verdict === 'drift' ? replacementFor(claim, issue) : undefined,
      fixable: verdict === 'drift' && claim.fixable,
    });
  }
  return results;
}

export function countVerdicts(results) {
  const counts = { total: results.length, match: 0, drift: 0, unverifiable: 0 };
  for (const r of results) counts[r.verdict] += 1;
  return counts;
}

/**
 * Read a Jira changelog and say when the page stopped being true.
 * @param {object} result one drift result
 * @param {object[]} histories Jira changelog values, any order
 */
export function explainDrift(result, histories) {
  const fieldName = { due: 'duedate', assignee: 'assignee', status: 'status', fixVersion: 'Fix Version', priority: 'priority' }[result.field];
  const changes = [];
  for (const h of histories || []) {
    for (const item of h.items || []) {
      if (String(item.field).toLowerCase() === fieldName.toLowerCase()) {
        changes.push({ at: h.created, by: (h.author && h.author.displayName) || 'someone', from: own(item, 'fromString') ?? item.from, to: own(item, 'toString') ?? item.to, fromId: item.from });
      }
    }
  }
  if (!changes.length) return null;
  changes.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = changes[changes.length - 1];
  const wasTrue = [...changes].reverse().find((c) => {
    if (c.from == null) return false;
    if (result.field === 'due') return sameDate(result.value, String(c.fromId || c.from).slice(0, 10));
    if (result.field === 'assignee') return (result.value.accountIds || []).includes(c.fromId) || (result.value.names || []).some((n) => sameName(n, c.from));
    if (result.field === 'status') return clean(result.value.text) === clean(c.from);
    return clean(result.raw) === clean(c.from);
  });
  return {
    changedAt: (wasTrue || last).at,
    changedBy: (wasTrue || last).by,
    from: (wasTrue || last).from,
    to: (wasTrue || last).to,
    wasTrueUntil: wasTrue ? wasTrue.at : null,
  };
}

export { toIso };
