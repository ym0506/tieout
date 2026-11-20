// Reads an Atlassian Document Format (ADF) tree and pulls out "claims":
// places where the page states a fact about one Jira work item
// (its due date, owner, status, fix version or priority).
//
// Precision first. A claim is only produced when the text leaves no doubt
// about which work item it talks about: a table row or a sentence that
// mentions exactly one key. Everything else is left alone.

import {
  findDates, dateFromTimestamp, STATUS_TERMS, isPlaceholder, meansNobody, clean,
} from './normalize.js';

export const ISSUE_KEY_RE = /(?<![A-Za-z0-9/_.-])([A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})(?![A-Za-z0-9_-])/g;

/** Work item key from a Jira URL (smart link, plain link), or null. */
export function keyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)/.exec(url)
    || /[?&]selectedIssue=([A-Z][A-Z0-9]{1,9}-\d+)/.exec(url)
    || /\/issues\/([A-Z][A-Z0-9]{1,9}-\d+)/.exec(url);
  return m ? m[1] : null;
}

const BLOCKS_WITH_TEXT = new Set(['paragraph', 'heading', 'taskItem', 'decisionItem', 'codeBlock']);
const SKIP = new Set(['codeBlock', 'extension', 'bodiedExtension', 'inlineExtension', 'media', 'mediaSingle', 'mediaGroup']);

// ---- flatten a block into text + parts -------------------------------------

function flatten(node, path) {
  const out = { text: '', parts: [] };
  const push = (part, text) => {
    out.parts.push({ ...part, start: out.text.length, end: out.text.length + text.length });
    out.text += text;
  };
  const visit = (n, p) => {
    if (!n || SKIP.has(n.type)) return;
    switch (n.type) {
      case 'text': {
        const link = (n.marks || []).find((mk) => mk.type === 'link');
        const linkKey = link ? keyFromUrl(link.attrs && link.attrs.href) : null;
        push({ kind: 'text', path: p, linkKey }, n.text || '');
        return;
      }
      case 'hardBreak':
        out.text += '\n';
        return;
      case 'date': {
        const d = dateFromTimestamp(n.attrs && n.attrs.timestamp);
        push({ kind: 'date', path: p, date: d }, d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '');
        return;
      }
      case 'mention':
        push({ kind: 'mention', path: p, accountId: n.attrs && n.attrs.id, name: String((n.attrs && n.attrs.text) || '').replace(/^@/, '') },
          String((n.attrs && n.attrs.text) || '@user'));
        return;
      case 'status':
        push({ kind: 'status', path: p, label: (n.attrs && n.attrs.text) || '' }, `[${(n.attrs && n.attrs.text) || ''}]`);
        return;
      case 'inlineCard':
      case 'blockCard':
      case 'embedCard': {
        const key = keyFromUrl(n.attrs && n.attrs.url);
        push({ kind: 'card', path: p, key }, key || ' link ');
        return;
      }
      case 'emoji':
        out.text += ' ';
        return;
      default:
        if (Array.isArray(n.content)) {
          n.content.forEach((c, i) => visit(c, [...p, i]));
          if (n.type !== 'text' && n.type !== 'doc') out.text += '\n';
        }
    }
  };
  visit(node, path);
  return out;
}

function keysIn(flat, from = 0, to = flat.text.length) {
  const found = [];
  const slice = flat.text.slice(from, to);
  ISSUE_KEY_RE.lastIndex = 0;
  let m;
  while ((m = ISSUE_KEY_RE.exec(slice)) !== null) {
    const at = from + m.index;
    const part = flat.parts.find((pt) => pt.start <= at && at < pt.end);
    found.push({ key: m[1], index: at, origin: part && part.kind === 'card' ? 'card' : 'text' });
  }
  for (const pt of flat.parts) {
    if (pt.kind === 'text' && pt.linkKey && pt.start >= from && pt.start < to
      && !found.some((f) => f.key === pt.linkKey && f.index >= pt.start && f.index < pt.end)) {
      found.push({ key: pt.linkKey, index: pt.start, origin: 'link' });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

const distinct = (mentions) => [...new Set(mentions.map((m) => m.key))];

/** Where a span of block text lives in the ADF tree, if it sits inside one text node. */
function locate(flat, from, to) {
  const part = flat.parts.find((pt) => pt.kind === 'text' && pt.start <= from && to <= pt.end);
  if (!part) return null;
  return { node: 'text', path: part.path, from: from - part.start, to: to - part.start };
}

// ---- sentences -------------------------------------------------------------

const NO_BREAK_BEFORE = /(?:\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|e\.g|i\.e|vs|no|approx|etc|mr|ms|dr)\.)$/i;

function splitAt(text, from, to, isBoundary, protectedSpans) {
  const pieces = [];
  let start = from;
  let i = from;
  const inProtected = (pos) => protectedSpans.some((s) => pos > s.index && pos < s.end);
  while (i < to) {
    const len = isBoundary(text, i);
    if (len > 0 && !inProtected(i)) {
      if (i + len > start) pieces.push([start, i + len]);
      start = i + len;
      i += len;
    } else {
      i += 1;
    }
  }
  if (start < to) pieces.push([start, to]);
  return pieces.filter(([a, b]) => text.slice(a, b).trim().length > 0);
}

const sentenceBoundary = (text, i) => {
  const ch = text[i];
  if (ch === '\n') return 1;
  if (ch === ';' || ch === '。') return 1;
  if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
    if (ch === '.' && NO_BREAK_BEFORE.test(text.slice(Math.max(0, i - 6), i + 1))) return 0;
    return 1;
  }
  return 0;
};

const clauseBoundary = (text, i) => {
  if (text[i] === ',') return 1;
  const rest = text.slice(i, i + 8).toLowerCase();
  for (const w of [' and ', ' but ', ' while ', ' whereas ']) if (rest.startsWith(w)) return w.length - 1;
  return 0;
};

// ---- cue words -------------------------------------------------------------

// A date is a due-date claim when the sentence says so outright (strong cue),
// or uses a forward-looking verb (weak cue) and does not describe something
// that already happened ("was fixed by Alice on Dec 3").
const DUE_STRONG = /\b(?:due|deadline|eta|target(?:ed|ing|s)?|scheduled|expected|planned for|slated)\b|마감|기한|예정|까지/i;
const DUE_WEAK = /\b(?:by|until|ships?|shipping|launch(?:es|ing)?|releas(?:e|es|ing)|deliver(?:y|s|ing)?|lands?|landing|goes live|go-live|go live)\b|출시|배포/i;
const PAST_EVENT = /\b(?:fixed|merged|closed|completed|resolved|finished|deployed|shipped|released|launched|delivered|landed|went live)\b/i;
const hasDueCue = (text) => DUE_STRONG.test(text) || MOVE_CUE.test(text) || (DUE_WEAK.test(text) && !PAST_EVENT.test(text));
const NOT_DUE_BEFORE = /(?:created|updated|as of|since|last|reported|started|opened|filed|written|published|reviewed|raised|logged|from)\s*(?:on\s*)?$/i;
const MOVE_CUE = /\b(?:moved|slipped|pushed|changed|rescheduled|delayed|postponed|brought forward)\b|연기|변경/i;

const NAME = "([A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+){0,2})";
const OWNER_PATTERNS = [
  new RegExp(`\\b(?:owner|assignee|dri|lead)\\s*(?:is|=|:|-|–)?\\s*@?${NAME}`, 'u'),
  new RegExp(`\\b(?:owned|led|handled|driven|taken|picked up)\\s+by\\s+@?${NAME}`, 'u'),
  new RegExp(`\\bassigned\\s+to\\s+@?${NAME}`, 'u'),
  /담당(?:자)?\s*(?:는|은|:|：)?\s*@?([가-힣]{2,5})/u,
];
const OWNER_CUE = /\b(?:owner|owned by|assignee|assigned to|dri|lead|led by|handled by|driven by|taken by|picked up by|responsible)\b|담당/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STATUS_ALT = STATUS_TERMS.map((t) => escapeRe(t).replace(/ /g, '[\\s-]')).join('|');
const STATUS_PATTERNS = [
  new RegExp(`\\b(?:is|are|was|now|currently|status(?:\\s+is)?|state(?:\\s+is)?|marked(?:\\s+as)?|moved\\s+to|remains|still)\\s*[:\\-–]?\\s*(?:now\\s+|currently\\s+|still\\s+)?(${STATUS_ALT})(?![\\p{L}])`, 'iu'),
  new RegExp(`[\\(\\[]\\s*(${STATUS_ALT})\\s*[\\)\\]]`, 'iu'),
  new RegExp(`(?:상태(?:는|:)?\\s*)(${STATUS_ALT})`, 'iu'),
];
const VERSION_PATTERNS = [
  /\b(?:fix version|release|version|ships? in|shipping in|lands? in|target(?:ing|ed)?(?: for)?|planned for|slated for)\s+v?(\d+\.\d+(?:\.\d+)?)\b/i,
  /\bv(\d+\.\d+(?:\.\d+)?)\b/,
];

// ---- claims from one single-key stretch of text ----------------------------

function claimsFromSegment(flat, from, to, key, where) {
  const text = flat.text.slice(from, to);
  const claims = [];
  const partsIn = flat.parts.filter((pt) => pt.start >= from && pt.end <= to);

  // due date
  const candidates = [];
  for (const pt of partsIn) if (pt.kind === 'date' && pt.date) candidates.push({ ...pt.date, raw: flat.text.slice(pt.start, pt.end), index: pt.start - from, end: pt.end - from, nodePath: pt.path });
  for (const d of findDates(text)) {
    if (candidates.some((c) => d.index < c.end && c.index < d.end)) continue;
    candidates.push(d);
  }
  candidates.sort((a, b) => a.index - b.index);
  const usable = candidates.filter((d) => !NOT_DUE_BEFORE.test(text.slice(0, d.index)));
  if (usable.length && hasDueCue(text)) {
    const d = MOVE_CUE.test(text) ? usable[usable.length - 1] : usable[0];
    claims.push({
      issueKey: key,
      field: 'due',
      raw: d.raw,
      value: { year: d.year, month: d.month, day: d.day, style: d.style, sep: d.sep, long: d.long, order: d.order, ambiguous: !!d.ambiguous },
      location: d.nodePath
        ? { node: 'date', path: d.nodePath, ...where }
        : { ...(locate(flat, from + d.index, from + d.end) || {}), ...where },
    });
  }

  // owner
  if (OWNER_CUE.test(text)) {
    const mention = partsIn.find((pt) => pt.kind === 'mention');
    if (mention) {
      claims.push({
        issueKey: key, field: 'assignee', raw: `@${mention.name}`,
        value: { names: [mention.name], accountIds: [mention.accountId].filter(Boolean) },
        location: { node: 'mention', path: mention.path, ...where },
      });
    } else {
      for (const re of OWNER_PATTERNS) {
        const m = re.exec(text);
        if (!m) continue;
        const name = m[1];
        const at = m.index + m[0].lastIndexOf(name);
        claims.push({
          issueKey: key, field: 'assignee', raw: name,
          value: { names: [name], accountIds: [] },
          location: { ...(locate(flat, from + at, from + at + name.length) || {}), ...where },
        });
        break;
      }
    }
  }

  // status
  const lozenge = partsIn.find((pt) => pt.kind === 'status' && pt.label);
  if (lozenge) {
    claims.push({
      issueKey: key, field: 'status', raw: lozenge.label, value: { text: lozenge.label },
      location: { node: 'status', path: lozenge.path, ...where },
    });
  } else {
    for (const re of STATUS_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const at = m.index + m[0].toLowerCase().lastIndexOf(m[1].toLowerCase());
      claims.push({
        issueKey: key, field: 'status', raw: m[1], value: { text: m[1] },
        location: { ...(locate(flat, from + at, from + at + m[1].length) || {}), ...where },
      });
      break;
    }
  }

  // fix version
  for (const re of VERSION_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const at = m.index + m[0].lastIndexOf(m[1]);
    claims.push({
      issueKey: key, field: 'fixVersion', raw: m[1], value: { text: m[1] },
      location: { ...(locate(flat, from + at, from + at + m[1].length) || {}), ...where },
    });
    break;
  }
  return claims;
}

function claimsFromText(flat, where) {
  const claims = [];
  const mentions = [];
  const dateSpans = findDates(flat.text);
  for (const [s, e] of splitAt(flat.text, 0, flat.text.length, sentenceBoundary, dateSpans)) {
    const ms = keysIn(flat, s, e);
    mentions.push(...ms);
    const keys = distinct(ms);
    const snippet = flat.text.slice(s, e).trim();
    if (keys.length === 1) {
      claims.push(...claimsFromSegment(flat, s, e, keys[0], { ...where, snippet }));
    } else if (keys.length > 1) {
      for (const [cs, ce] of splitAt(flat.text, s, e, clauseBoundary, dateSpans)) {
        const ck = distinct(keysIn(flat, cs, ce));
        if (ck.length === 1) claims.push(...claimsFromSegment(flat, cs, ce, ck[0], { ...where, snippet: flat.text.slice(cs, ce).trim() }));
      }
    }
  }
  return { claims, mentions };
}

// ---- tables ----------------------------------------------------------------

const HEADER_FIELDS = [
  { fields: ['due'], re: /^(?:due|due date|deadline|target date|eta|ship date|launch date|launch|delivery|delivery date|go live|go live date|end date|마감|마감일|기한|일정|출시일|목표일|완료 예정일)$/ },
  { fields: ['assignee'], re: /^(?:owner|assignee|assigned to|dri|lead|who|responsible|담당|담당자)$/ },
  { fields: ['status'], re: /^(?:status|state|progress|jira status|상태|진행 상황|진행 상태)$/ },
  { fields: ['fixVersion'], re: /^(?:version|fix version|fix versions|버전|릴리스)$/ },
  { fields: ['due', 'fixVersion'], re: /^(?:release|target release|target|release date)$/ },
  { fields: ['priority'], re: /^(?:priority|우선순위)$/ },
];

export function fieldsOfHeader(text) {
  const t = clean(String(text || '').replace(/[^\p{L}\p{N}\s]/gu, ' '));
  const hit = HEADER_FIELDS.find((h) => h.re.test(t));
  return hit ? hit.fields : null;
}

function claimFromCell(flat, fields, key, where) {
  const text = flat.text.replace(/\n+/g, ' ').trim();
  if (isPlaceholder(text)) return null;
  const snippet = text.slice(0, 160);
  const loc = (span) => ({ ...(span || {}), ...where, snippet });

  for (const field of fields) {
    if (field === 'due') {
      const node = flat.parts.find((pt) => pt.kind === 'date' && pt.date);
      if (node) {
        return { issueKey: key, field, raw: flat.text.slice(node.start, node.end), value: { ...node.date, ambiguous: false }, location: loc({ node: 'date', path: node.path }) };
      }
      const d = findDates(flat.text)[0];
      if (d) {
        return {
          issueKey: key, field, raw: d.raw,
          value: { year: d.year, month: d.month, day: d.day, style: d.style, sep: d.sep, long: d.long, order: d.order, ambiguous: !!d.ambiguous },
          location: loc(locate(flat, d.index, d.end)),
        };
      }
      if (fields.length > 1) continue; // "Release" column holding a version, not a date
      return { issueKey: key, field, raw: text, value: null, uncheckable: 'not a specific date', location: loc() };
    }
    if (field === 'assignee') {
      const people = flat.parts.filter((pt) => pt.kind === 'mention');
      if (people.length) {
        return {
          issueKey: key, field, raw: people.map((p) => `@${p.name}`).join(', '),
          value: { names: people.map((p) => p.name), accountIds: people.map((p) => p.accountId).filter(Boolean) },
          location: loc(people.length === 1 ? { node: 'mention', path: people[0].path } : null),
        };
      }
      if (meansNobody(text)) return { issueKey: key, field, raw: text, value: { names: [], accountIds: [], nobody: true }, location: loc(whole(flat)) };
      return { issueKey: key, field, raw: text, value: { names: text.split(/\s*[,/&]\s*|\s+and\s+/).map((s) => s.replace(/^@/, '').trim()).filter(Boolean), accountIds: [] }, location: loc(whole(flat)) };
    }
    if (field === 'status') {
      const node = flat.parts.find((pt) => pt.kind === 'status' && pt.label);
      if (node) return { issueKey: key, field, raw: node.label, value: { text: node.label }, location: loc({ node: 'status', path: node.path }) };
      return { issueKey: key, field, raw: text, value: { text }, location: loc(whole(flat)) };
    }
    if (field === 'fixVersion' || field === 'priority') {
      return { issueKey: key, field, raw: text, value: { text }, location: loc(whole(flat)) };
    }
  }
  return null;
}

/** The whole cell, when it is one text node, so a fix can replace it. */
function whole(flat) {
  const texts = flat.parts.filter((pt) => pt.kind === 'text' && flat.text.slice(pt.start, pt.end).trim());
  if (texts.length !== 1 || flat.parts.some((pt) => pt.kind !== 'text')) return null;
  const pt = texts[0];
  const raw = flat.text.slice(pt.start, pt.end);
  const lead = raw.length - raw.trimStart().length;
  return { node: 'text', path: pt.path, from: lead, to: lead + raw.trim().length };
}

function claimsFromTable(table, path, tableIndex) {
  const rows = (table.content || []).map((row, r) => ({
    r,
    cells: (row.content || []).map((cell, c) => ({ type: cell.type, c, flat: flatten(cell, [...path, r, c]) })),
  })).filter((row) => row.cells.length);
  if (!rows.length) return null;

  const claims = [];
  const mentions = [];
  const handled = new Set();

  // Header row on top: one work item per row.
  const head = rows[0];
  const columns = head.cells.map((cell) => fieldsOfHeader(cell.flat.text));
  if (columns.some(Boolean)) {
    for (const row of rows.slice(1)) {
      const rowMentions = row.cells.flatMap((cell) => keysIn(cell.flat));
      const keys = distinct(rowMentions);
      if (keys.length !== 1) continue;
      row.cells.forEach((cell) => {
        const fields = columns[cell.c];
        if (!fields) return;
        handled.add(`${row.r}:${cell.c}`);
        const header = head.cells[cell.c] ? head.cells[cell.c].flat.text.trim() : '';
        const claim = claimFromCell(cell.flat, fields, keys[0], { kind: 'table', table: tableIndex, row: row.r, col: cell.c, header });
        if (claim) claims.push(claim);
      });
    }
  } else if (rows.every((row) => row.cells.length === 2) && rows.some((row) => fieldsOfHeader(row.cells[0].flat.text))) {
    // Header column on the left ("page properties" style): the table is about one work item.
    const keys = distinct(rows.flatMap((row) => row.cells.flatMap((cell) => keysIn(cell.flat))));
    if (keys.length === 1) {
      for (const row of rows) {
        const fields = fieldsOfHeader(row.cells[0].flat.text);
        if (!fields) continue;
        handled.add(`${row.r}:1`);
        const claim = claimFromCell(row.cells[1].flat, fields, keys[0], { kind: 'table', table: tableIndex, row: row.r, col: 1, header: row.cells[0].flat.text.trim() });
        if (claim) claims.push(claim);
      }
    }
  }

  // Cells the table rules did not use are read as ordinary sentences.
  for (const row of rows) {
    for (const cell of row.cells) {
      if (handled.has(`${row.r}:${cell.c}`)) {
        mentions.push(...keysIn(cell.flat));
        continue;
      }
      const res = claimsFromText(cell.flat, { kind: 'text', table: tableIndex, row: row.r, col: cell.c });
      claims.push(...res.claims);
      mentions.push(...res.mentions);
    }
  }
  return { claims, mentions };
}

// ---- entry point -----------------------------------------------------------

/**
 * @param {object} doc ADF document
 * @returns {{claims: object[], issueKeys: string[], mentions: {key:string, origin:string}[]}}
 */
export function extractClaims(doc) {
  const claims = [];
  const mentions = [];
  let tableIndex = 0;

  const walk = (node, path) => {
    if (!node || typeof node !== 'object' || SKIP.has(node.type)) return;
    if (node.type === 'table') {
      const res = claimsFromTable(node, path, tableIndex);
      tableIndex += 1;
      if (res) { claims.push(...res.claims); mentions.push(...res.mentions); }
      return;
    }
    if (BLOCKS_WITH_TEXT.has(node.type)) {
      const res = claimsFromText(flatten(node, path), { kind: 'text' });
      claims.push(...res.claims);
      mentions.push(...res.mentions);
      return;
    }
    if (node.type === 'blockCard' || node.type === 'embedCard') {
      const key = keyFromUrl(node.attrs && node.attrs.url);
      if (key) mentions.push({ key, origin: 'card' });
      return;
    }
    (node.content || []).forEach((child, i) => walk(child, [...path, i]));
  };
  walk(doc, []);

  const seen = {};
  claims.forEach((c) => {
    const k = `${c.issueKey}|${c.field}`;
    seen[k] = (seen[k] || 0) + 1;
    c.id = `${k}|${seen[k]}`;
    c.fixable = !c.uncheckable && !!(c.location && c.location.path);
  });

  // A key that only appears as bare text may be something like "UTF-8";
  // remember how each key was written so unknown text-only keys can be dropped later.
  const origin = {};
  for (const m of mentions) {
    if (!origin[m.key] || origin[m.key] === 'text') origin[m.key] = m.origin;
  }
  return {
    claims,
    issueKeys: Object.keys(origin),
    mentions: Object.entries(origin).map(([key, o]) => ({ key, origin: o })),
  };
}

/** Turn plain text or simple Markdown (what an agent drafts) into ADF so the same rules apply. */
export function textToAdf(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const content = [];
  let i = 0;
  const para = (s) => ({ type: 'paragraph', content: s ? [{ type: 'text', text: s }] : [] });
  const stripMd = (s) => s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => (keyFromUrl(url) && !label.includes(keyFromUrl(url)) ? `${label} ${keyFromUrl(url)}` : label));
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { block.push(lines[i]); i += 1; }
      const rows = block
        .filter((l) => !/^[\s|:-]+$/.test(l))
        .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => stripMd(c.trim())));
      content.push({
        type: 'table',
        content: rows.map((cells, r) => ({
          type: 'tableRow',
          content: cells.map((c) => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [para(c)] })),
        })),
      });
      continue;
    }
    const cleaned = stripMd(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^#+\s*/, ''));
    if (cleaned.trim()) content.push(para(cleaned));
    i += 1;
  }
  return { type: 'doc', version: 1, content };
}
