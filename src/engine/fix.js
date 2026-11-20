// Applies fixes to an ADF document: each drifted claim is rewritten in place
// with the value Jira holds now. Nothing else on the page is touched.

import { timestampFromIso } from './normalize.js';

const nodeAt = (doc, path) => path.reduce((n, i) => (n && n.content ? n.content[i] : undefined), doc);

const STATUS_COLOR = { done: 'green', indeterminate: 'blue', new: 'neutral' };

/**
 * @param {object} doc ADF document (not modified)
 * @param {object[]} results evaluated claims; only fixable drifts are applied
 * @returns {{doc: object, applied: string[], skipped: string[]}}
 */
export function applyFixes(doc, results) {
  const out = JSON.parse(JSON.stringify(doc));
  const applied = [];
  const skipped = [];
  const todo = results.filter((r) => r.verdict === 'drift');

  // Text edits change offsets, so within one text node go right to left.
  const order = (r) => (r.location && r.location.node === 'text' ? r.location.from : 0);
  todo.sort((a, b) => order(b) - order(a));

  for (const r of todo) {
    const loc = r.location || {};
    const node = r.fixable && loc.path ? nodeAt(out, loc.path) : null;
    if (!node) { skipped.push(r.id); continue; }

    if (loc.node === 'text' && node.type === 'text') {
      const current = node.text.slice(loc.from, loc.to);
      if (current !== r.raw) { skipped.push(r.id); continue; }
      node.text = node.text.slice(0, loc.from) + r.replacement + node.text.slice(loc.to);
      applied.push(r.id);
    } else if (loc.node === 'date' && node.type === 'date') {
      const ts = r.actual && r.actual.iso ? timestampFromIso(r.actual.iso) : null;
      if (!ts) { skipped.push(r.id); continue; }
      node.attrs = { ...node.attrs, timestamp: ts };
      applied.push(r.id);
    } else if (loc.node === 'mention' && node.type === 'mention') {
      if (r.actual && r.actual.accountId) {
        node.attrs = { ...node.attrs, id: r.actual.accountId, text: `@${r.actual.display}` };
      } else {
        delete node.attrs;
        node.type = 'text';
        node.text = 'Unassigned';
      }
      applied.push(r.id);
    } else if (loc.node === 'status' && node.type === 'status') {
      node.attrs = { ...node.attrs, text: r.actual.display, color: STATUS_COLOR[r.actual.category] || 'neutral' };
      applied.push(r.id);
    } else {
      skipped.push(r.id);
    }
  }
  return { doc: out, applied, skipped };
}
