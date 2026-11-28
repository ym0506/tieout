// How many real changes in Jira does Tie-Out notice, and does it stay quiet on cosmetic ones?
//
// Takes every fact on the measured Apache pages that matches Jira today, changes the
// Jira side under it, and checks the page again with the engine unchanged:
//   real change      the value really differs (another release, another status
//                    category, a date two weeks later, another person) → should be "out of date"
//   cosmetic change  Jira writes the same value another way ("1.18" → "1.18.0",
//                    "1.18.0" → "v1.18.0", a status renamed within the same category)
//                    → should stay "matches"
//
// Works from the cache that scripts/measure-apache.mjs fills; run that first.
//   node scripts/seeded-changes.mjs flink kafka

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractClaims, evaluate, reduceIssue } from '../src/engine/index.js';
import { storageToAdf } from './storage-to-adf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'apache');
const DATASETS = {
  kafka: { keep: /^release plan \d/i },
  flink: { keep: /^FLIP-\d+/i },
};
const read = (f) => JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));

function load(name) {
  const pages = [];
  for (let start = 0; ; start += 50) {
    const f = `list-${name}-${start}.json`;
    if (!fs.existsSync(path.join(cache, f))) throw new Error(`no cache for ${name}: run measure-apache.mjs ${name} first`);
    const data = read(f);
    pages.push(...data.results.filter((r) => DATASETS[name].keep.test(r.title)).map((r) => ({ id: r.id, title: r.title })));
    if (data.results.length < 50) break;
  }
  const docs = pages
    .filter((p) => fs.existsSync(path.join(cache, `page-${p.id}.json`)))
    .map((p) => ({ ...p, doc: storageToAdf(read(`page-${p.id}.json`).body.storage.value) }));
  // Read the same Jira answers, in the same chunks, that measure-apache.mjs used.
  const keys = [...new Set(docs.flatMap((p) => extractClaims(p.doc).claims.map((c) => c.issueKey)))];
  const issues = {};
  const has = (f) => fs.existsSync(path.join(cache, f));
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const f = `jira-${createHash('sha1').update(chunk.join(',')).digest('hex').slice(0, 16)}.json`;
    if (has(f)) for (const issue of read(f).issues || []) issues[issue.key] = reduceIssue(issue);
    else for (const key of chunk) if (has(`issue-${key}.json`)) { const issue = read(`issue-${key}.json`); issues[issue.key] = reduceIssue(issue); }
  }
  return { docs, issues };
}

const nextMinor = (v) => {
  const m = /^(\D*)(\d+)\.(\d+)(.*)$/.exec(v);
  return m ? `${m[1]}${m[2]}.${Number(m[3]) + 1}${m[4].replace(/^\.\d+/, '.0')}` : `${v}-next`;
};
const shift = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Change the Jira value under one fact. Returns null when this kind of change does not apply. */
function seed(issue, field, kind) {
  const i = JSON.parse(JSON.stringify(issue));
  if (field === 'fixVersion') {
    if (!i.fixVersions.length) return null;
    if (kind === 'real') i.fixVersions = i.fixVersions.map(nextMinor);
    else {
      // Same release, written the way some projects name versions: "1.18" → "1.18.0", "1.18.0" → "v1.18.0".
      i.fixVersions = i.fixVersions.map((v) => (/^\d+\.\d+$/.test(v) ? `${v}.0` : /^\d/.test(v) ? `v${v}` : v));
      if (i.fixVersions.every((v, k) => v === issue.fixVersions[k])) return null;
    }
  } else if (field === 'status') {
    if (!i.status) return null;
    const cat = i.status.category;
    if (kind === 'real') i.status = cat === 'done' ? { name: 'In Progress', category: 'indeterminate' } : { name: 'Closed', category: 'done' };
    else {
      const sameCategory = { done: ['Resolved', 'Closed', 'Done'], indeterminate: ['In Progress', 'Patch Available', 'In Review'], new: ['Open', 'To Do', 'Backlog'] }[cat] || [];
      const other = sameCategory.find((n) => n.toLowerCase() !== i.status.name.toLowerCase());
      if (!other) return null;
      i.status = { name: other, category: cat };
    }
  } else if (field === 'due') {
    if (!i.duedate || kind !== 'real') return null;
    i.duedate = shift(i.duedate, 14);
  } else if (field === 'assignee') {
    if (!i.assignee || kind !== 'real') return null;
    i.assignee = { accountId: 'seeded-other', displayName: 'Someone Else' };
  } else if (field === 'priority') {
    if (!i.priority || kind !== 'real') return null;
    i.priority = i.priority === 'Major' ? 'Minor' : 'Major';
  } else return null;
  return i;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['flink', 'kafka'];
const report = { measuredAt: new Date().toISOString().slice(0, 10), datasets: {} };

for (const name of names) {
  const { docs, issues } = load(name);
  const rows = { real: { seeded: 0, flagged: 0, missed: [] }, cosmetic: { seeded: 0, quiet: 0, alarms: [] }, sideEffects: 0, byField: {} };
  for (const page of docs) {
    const ex = extractClaims(page.doc);
    const origins = Object.fromEntries(ex.mentions.map((m) => [m.key, m.origin]));
    const base = evaluate(ex.claims, issues, { origins });
    for (const target of base.filter((r) => r.verdict === 'match')) {
      for (const kind of ['real', 'cosmetic']) {
        const changed = seed(issues[target.issueKey], target.field, kind);
        if (!changed) continue;
        const after = evaluate(ex.claims, { ...issues, [target.issueKey]: changed }, { origins });
        const hit = after.find((r) => r.id === target.id);
        const f = (rows.byField[target.field] = rows.byField[target.field] || { real: 0, flagged: 0, cosmetic: 0, quiet: 0 });
        // Facts about other work items must not move.
        rows.sideEffects += after.filter((r, k) => r.issueKey !== target.issueKey && r.verdict !== base[k].verdict).length;
        if (kind === 'real') {
          rows.real.seeded += 1; f.real += 1;
          if (hit && hit.verdict === 'drift') { rows.real.flagged += 1; f.flagged += 1; } else rows.real.missed.push({ page: page.title, id: target.id, pageSays: target.raw, now: hit && hit.verdict });
        } else {
          rows.cosmetic.seeded += 1; f.cosmetic += 1;
          if (hit && hit.verdict === 'match') { rows.cosmetic.quiet += 1; f.quiet += 1; } else rows.cosmetic.alarms.push({ page: page.title, id: target.id, pageSays: target.raw, jiraNow: changed, now: hit && hit.verdict });
        }
      }
    }
  }
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
  report.datasets[name] = {
    realChanges: { seeded: rows.real.seeded, flagged: rows.real.flagged, share: pct(rows.real.flagged, rows.real.seeded), missed: rows.real.missed.slice(0, 20) },
    cosmeticChanges: { seeded: rows.cosmetic.seeded, quiet: rows.cosmetic.quiet, share: pct(rows.cosmetic.quiet, rows.cosmetic.seeded), alarms: rows.cosmetic.alarms.slice(0, 20) },
    factsAboutOtherWorkItemsThatMoved: rows.sideEffects,
    byField: rows.byField,
  };
}

const out = path.join(root, 'docs', 'evidence', 'seeded-changes.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
