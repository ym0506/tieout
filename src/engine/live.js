// "Make it live": a status table whose every column Tie-Out understands can be replaced
// with a Jira table (the Confluence Jira macro), which always shows Jira's current values.
// Only tables where nothing would be lost qualify; anything else is reported with the reason.

import { fieldsOfHeader, ISSUE_KEY_RE, keyFromUrl } from './extract.js';

const KEY_HEADER = /^(?:work item|work items|key|issue|issues|issue key|ticket|jira|item|task|epic|story|작업|이슈|티켓|업무)$/;
const SUMMARY_HEADER = /^(?:summary|title|name|description|what|요약|제목|내용)$/;
const MAX_ROWS = 50;

// Jira macro column names and ids for each kind of column.
const JIRA_COLUMN = {
  key: ['key', 'issuekey'],
  summary: ['summary', 'summary'],
  assignee: ['assignee', 'assignee'],
  due: ['due', 'duedate'],
  status: ['status', 'status'],
  fixVersion: ['fixversions', 'fixVersions'],
  priority: ['priority', 'priority'],
};

const clean = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Text of a cell and the work item keys in it. */
function readCell(cell) {
  let text = '';
  const keys = [];
  const visit = (n) => {
    if (!n) return;
    if (n.type === 'text') {
      text += n.text || '';
      const link = (n.marks || []).find((m) => m.type === 'link');
      const k = link ? keyFromUrl(link.attrs && link.attrs.href) : null;
      if (k) keys.push(k);
      ISSUE_KEY_RE.lastIndex = 0;
      let m;
      while ((m = ISSUE_KEY_RE.exec(n.text || '')) !== null) keys.push(m[1]);
      return;
    }
    if (n.type === 'inlineCard' || n.type === 'blockCard' || n.type === 'embedCard') {
      const k = keyFromUrl(n.attrs && n.attrs.url);
      if (k) keys.push(k);
      text += k ? ` ${k} ` : ' link ';
      return;
    }
    if ((n.type === 'inlineExtension' || n.type === 'extension') && n.attrs && n.attrs.extensionKey === 'jira') {
      const p = n.attrs.parameters && n.attrs.parameters.macroParams;
      const k = p && p.key && p.key.value;
      if (k) { keys.push(String(k)); text += ` ${k} `; }
      return;
    }
    if (n.type === 'mention') { text += ` ${(n.attrs && n.attrs.text) || '@user'} `; return; }
    if (n.type === 'status') { text += ` ${(n.attrs && n.attrs.text) || ''} `; return; }
    if (n.type === 'date') { text += ' date '; return; }
    (n.content || []).forEach(visit);
    text += ' ';
  };
  visit(cell);
  return { text: text.replace(/\s+/g, ' ').trim(), keys: [...new Set(keys)] };
}

function kindOfHeader(text) {
  const t = clean(text);
  if (KEY_HEADER.test(t)) return 'key';
  if (SUMMARY_HEADER.test(t)) return 'summary';
  const fields = fieldsOfHeader(text);
  if (fields && fields.length === 1) return fields[0];
  return null; // unknown, or ambiguous such as "Release" (a date or a version)
}

/** Every table in the document, with its path from the root. */
function tablesIn(doc) {
  const out = [];
  const walk = (n, path) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'table') { out.push({ node: n, path }); return; }
    (n.content || []).forEach((c, i) => walk(c, [...path, i]));
  };
  walk(doc, []);
  return out;
}

/**
 * Tables that list work items one per row, each judged for "make it live".
 * @returns {{id: string, path: number[], keys: string[], columns: string[], eligible: boolean, reason?: string}[]}
 */
export function findLiveTables(doc) {
  const found = [];
  for (const { node, path } of tablesIn(doc)) {
    const rows = (node.content || []).filter((r) => r.type === 'tableRow' && (r.content || []).length);
    if (rows.length < 2) continue;
    const head = rows[0].content.map((cell) => readCell(cell).text);
    const kinds = head.map(kindOfHeader);
    const body = rows.slice(1).map((r) => r.content.map(readCell));
    const rowKeys = body.map((cells) => [...new Set(cells.flatMap((c) => c.keys))]);
    // Only tables that list work items one per row are candidates at all.
    if (!rowKeys.some((k) => k.length === 1)) continue;

    const keyCol = kinds.indexOf('key') >= 0 ? kinds.indexOf('key')
      : head.findIndex((_, c) => body.every((cells) => cells[c] && cells[c].keys.length === 1));
    const table = { id: path.join('.'), path, keys: rowKeys.map((k) => k[0]).filter(Boolean), columns: [], eligible: false };

    const unknown = head.filter((h, c) => c !== keyCol && !kinds[c]);
    if (keyCol < 0) table.reason = 'No column holds the work item key on every row.';
    else if (unknown.length) table.reason = `The ${unknown.map((h) => `"${h || 'untitled'}"`).join(', ')} column cannot be shown by a Jira table, so it would be lost.`;
    else if (rowKeys.some((k) => k.length !== 1)) table.reason = 'Every row must name exactly one work item.';
    else if (new Set(table.keys).size !== table.keys.length) table.reason = 'A work item appears on more than one row.';
    else if (table.keys.length > MAX_ROWS) table.reason = `More than ${MAX_ROWS} rows.`;
    else {
      const cols = kinds.map((k, c) => (c === keyCol ? 'key' : k));
      if (!cols.includes('summary')) cols.splice(cols.indexOf('key') + 1, 0, 'summary');
      table.columns = [...new Set(cols)];
      table.eligible = true;
    }
    found.push(table);
  }
  return found;
}

/** The Confluence Jira macro, as ADF, showing these work items with these columns. */
export function jiraTableNode(keys, columns, newId = () => globalThis.crypto.randomUUID()) {
  const cols = columns.filter((c) => JIRA_COLUMN[c]);
  return {
    type: 'extension',
    attrs: {
      layout: 'default',
      extensionType: 'com.atlassian.confluence.macro.core',
      extensionKey: 'jira',
      parameters: {
        macroParams: {
          server: { value: 'System Jira' },
          columns: { value: cols.map((c) => JIRA_COLUMN[c][0]).join(',') },
          columnIds: { value: cols.map((c) => JIRA_COLUMN[c][1]).join(',') },
          maximumIssues: { value: String(Math.max(20, keys.length)) },
          // A Jira table cannot keep the author's row order; status tables usually read by due date.
          jqlQuery: { value: `key in (${keys.join(',')}) ORDER BY ${cols.includes('due') ? 'duedate ASC, key ASC' : 'key ASC'}` },
        },
        macroMetadata: { macroId: { value: newId() }, schemaVersion: { value: '1' }, title: 'Jira Legacy' },
      },
      localId: newId(),
    },
  };
}

/** A copy of the document with the table at `path` replaced by a live Jira table. */
export function replaceWithJiraTable(doc, table, newId) {
  const out = JSON.parse(JSON.stringify(doc));
  const parentPath = table.path.slice(0, -1);
  const parent = parentPath.reduce((n, i) => n.content[i], out);
  parent.content[table.path[table.path.length - 1]] = jiraTableNode(table.keys, table.columns, newId);
  return out;
}
