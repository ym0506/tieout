// Measures how often hand-written facts on real wiki pages disagree with Jira,
// using Tie-Out's engine unchanged, on public Apache data:
//   pages  — Apache Kafka "Release Plan" pages on cwiki.apache.org (Confluence)
//   issues — issues.apache.org/jira (Jira)
// Read-only, anonymous, a few hundred requests with a pause between them.
//
//   node scripts/measure-apache.mjs            # fetch (cached under .cache/) and report
//
// Limits to keep in mind when quoting the result: this is Confluence/Jira Data Center of an
// open-source project, not a company's Cloud site; release plans are written for a moment
// in time, so some drift is expected by design; and only facts Tie-Out's rules can read are counted.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractClaims, evaluate, countVerdicts, reduceIssue } from '../src/engine/index.js';
import { storageToAdf } from './storage-to-adf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'apache');
fs.mkdirSync(cache, { recursive: true });
const DATASETS = {
  kafka: { cql: 'space=KAFKA and type=page and title~"Release Plan"', keep: /^release plan \d/i, label: 'cwiki.apache.org, space KAFKA, pages titled "Release Plan <version>"', out: 'apache-kafka-release-plans.json' },
  flink: { cql: 'space=FLINK and type=page and title~"FLIP"', keep: /^FLIP-\d+/i, label: 'cwiki.apache.org, space FLINK, design pages titled "FLIP-<n>"', out: 'apache-flink-flips.json' },
};
const name = process.argv[2] || 'kafka';
const dataset = DATASETS[name];
if (!dataset) { console.error(`unknown dataset ${name}`); process.exit(1); }
const WIKI = 'https://cwiki.apache.org/confluence/rest/api';
const JIRA = 'https://issues.apache.org/jira/rest/api/2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, file) {
  const f = path.join(cache, file);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  await sleep(350);
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'tieout-measurement/0.1 (read-only research script)' } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const data = await res.json();
  fs.writeFileSync(f, JSON.stringify(data));
  return data;
}

async function listPages() {
  const pages = [];
  for (let start = 0; ; start += 50) {
    const cql = encodeURIComponent(dataset.cql);
    const data = await getJson(`${WIKI}/content/search?cql=${cql}&limit=50&start=${start}`, `list-${name}-${start}.json`);
    pages.push(...data.results.map((r) => ({ id: r.id, title: r.title })));
    if (data.results.length < 50) break;
  }
  return pages.filter((p) => dataset.keep.test(p.title));
}

async function fetchIssues(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const jql = encodeURIComponent(`key in (${chunk.join(',')})`);
    try {
      const data = await getJson(`${JIRA}/search?jql=${jql}&maxResults=100&validateQuery=false&fields=summary,status,assignee,duedate,fixVersions,priority`, `issues-${chunk[0]}-${chunk.length}.json`);
      for (const issue of data.issues || []) out[issue.key] = reduceIssue(issue);
    } catch (e) {
      for (const key of chunk) {
        try {
          const issue = await getJson(`${JIRA}/issue/${key}?fields=summary,status,assignee,duedate,fixVersions,priority`, `issue-${key}.json`);
          out[issue.key] = reduceIssue(issue);
        } catch (err) { /* unknown key */ }
      }
    }
  }
  return out;
}

const pages = await listPages();
const perPage = [];
const all = [];
for (const page of pages) {
  const data = await getJson(`${WIKI}/content/${page.id}?expand=body.storage,version`, `page-${page.id}.json`);
  const doc = storageToAdf(data.body.storage.value);
  const ex = extractClaims(doc);
  perPage.push({ ...page, lastEdited: data.version.when.slice(0, 10), ex });
}
const keys = [...new Set(perPage.flatMap((p) => p.ex.claims.map((c) => c.issueKey)))];
const issues = await fetchIssues(keys);

for (const p of perPage) {
  const origins = Object.fromEntries(p.ex.mentions.map((m) => [m.key, m.origin]));
  p.results = evaluate(p.ex.claims, issues, { origins });
  p.counts = countVerdicts(p.results);
  for (const r of p.results) all.push({ page: p.title, pageId: p.id, lastEdited: p.lastEdited, ...r });
}

const byField = {};
for (const r of all) {
  byField[r.field] = byField[r.field] || { total: 0, match: 0, drift: 0, unverifiable: 0 };
  byField[r.field].total += 1;
  byField[r.field][r.verdict] += 1;
}
const totals = countVerdicts(all);
const checkable = totals.match + totals.drift;
const pagesWithClaims = perPage.filter((p) => p.counts.total > 0);
const pagesWithDrift = perPage.filter((p) => p.counts.drift > 0);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

const summary = {
  measuredAt: new Date().toISOString().slice(0, 10),
  source: { pages: dataset.label, issues: 'issues.apache.org/jira' },
  pages: pages.length,
  pagesWithClaims: pagesWithClaims.length,
  pagesWithDrift: pagesWithDrift.length,
  workItems: keys.length,
  workItemsFound: Object.keys(issues).length,
  claims: totals,
  checkable,
  driftShareOfCheckable: pct(totals.drift, checkable),
  driftJiraHasOtherValue: all.filter((r) => r.verdict === 'drift' && !/^no /.test(r.actual.display) && r.actual.display !== 'Unassigned').length,
  driftJiraHasNoValue: all.filter((r) => r.verdict === 'drift' && (/^no /.test(r.actual.display) || r.actual.display === 'Unassigned')).length,
  byField,
};

const sample = all.filter((r) => r.verdict === 'drift').slice(0, 400).map((r) => ({
  page: r.page, pageLastEdited: r.lastEdited, workItem: r.issueKey, field: r.field, pageSays: r.raw, jiraSays: r.actual && r.actual.display,
}));
const unverifiable = {};
for (const r of all.filter((x) => x.verdict === 'unverifiable')) {
  const k = `${r.field}: ${String(r.raw).slice(0, 40)}`;
  unverifiable[k] = (unverifiable[k] || 0) + 1;
}

const outDir = path.join(root, 'docs', 'evidence');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, dataset.out), JSON.stringify({ summary, perPage: perPage.map((p) => ({ id: p.id, title: p.title, lastEdited: p.lastEdited, counts: p.counts })), drift: sample, unverifiableTop: Object.entries(unverifiable).sort((a, b) => b[1] - a[1]).slice(0, 40) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('pages with most drift:', pagesWithDrift.sort((a, b) => b.counts.drift - a.counts.drift).slice(0, 8).map((p) => `${p.title} (${p.counts.drift}/${p.counts.total})`).join('; '));
console.log('drift examples:', JSON.stringify(sample.slice(0, 12), null, 1));
console.log('top unverifiable:', Object.entries(unverifiable).sort((a, b) => b[1] - a[1]).slice(0, 15));
