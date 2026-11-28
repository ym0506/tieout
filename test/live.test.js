// "Make it live": which tables can become a Jira table without losing anything, and the macro that replaces them.

import { describe, it, expect } from 'vitest';
import { findLiveTables, jiraTableNode, replaceWithJiraTable, extractClaims } from '../src/engine/index.js';
import { doc, p, card, cell, th, row, table, link, mention, status } from './helpers.js';

const ids = () => { let n = 0; return () => `id-${(n += 1)}`; };

const statusTable = () => table(
  row(th('Work item'), th('Owner'), th('Due'), th('Status')),
  row(cell(card('PAY-12')), cell('Minsu Kim'), cell('Dec 3'), cell(status('In Progress'))),
  row(cell(card('PAY-13')), cell(mention('acc-jy', 'Jiyoung Park')), cell('Dec 17'), cell('Done')),
);

describe('findLiveTables', () => {
  it('accepts a status table whose columns a Jira table can show', () => {
    const [t] = findLiveTables(doc(p('Weekly status'), statusTable()));
    expect(t).toMatchObject({ id: '1', eligible: true, keys: ['PAY-12', 'PAY-13'], columns: ['key', 'summary', 'assignee', 'due', 'status'] });
  });

  it('keeps a summary column where the author put it and reads plain keys and links', () => {
    const [t] = findLiveTables(doc(table(
      row(th('Key'), th('Summary'), th('Priority'), th('Fix version')),
      row(cell('PAY-12'), cell('Payments launch'), cell('High'), cell('2.4')),
      row(cell(link('PAY-13', 'https://acme.atlassian.net/browse/PAY-13')), cell('Refunds'), cell('Low'), cell('2.5')),
    )));
    expect(t).toMatchObject({ eligible: true, keys: ['PAY-12', 'PAY-13'], columns: ['key', 'summary', 'priority', 'fixVersion'] });
  });

  it('refuses a table with a column a Jira table cannot show, and says which', () => {
    const [t] = findLiveTables(doc(table(
      row(th('Work item'), th('Owner'), th('Notes')),
      row(cell(card('PAY-12')), cell('Minsu Kim'), cell('Waiting on legal')),
    )));
    expect(t.eligible).toBe(false);
    expect(t.reason).toContain('"Notes"');
  });

  it('refuses rows that name two work items, and an ambiguous "Release" column', () => {
    const [two] = findLiveTables(doc(table(
      row(th('Work item'), th('Owner')),
      row(cell(card('PAY-12'), ' and ', card('PAY-14')), cell('Minsu Kim')),
      row(cell(card('PAY-13')), cell('Jiyoung Park')),
    )));
    expect(two).toMatchObject({ eligible: false, reason: 'Every row must name exactly one work item.' });
    const [release] = findLiveTables(doc(table(
      row(th('Work item'), th('Release')),
      row(cell(card('PAY-12')), cell('2.4')),
    )));
    expect(release.eligible).toBe(false);
    expect(release.reason).toContain('"Release"');
  });

  it('ignores tables that do not list work items, and finds tables inside layouts', () => {
    expect(findLiveTables(doc(table(row(th('Name'), th('Role')), row(cell('Ana'), cell('Lead')))))).toEqual([]);
    const nested = doc(p('x'), { type: 'layoutSection', content: [{ type: 'layoutColumn', attrs: {}, content: [statusTable()] }] });
    expect(findLiveTables(nested)[0]).toMatchObject({ id: '1.0.0', eligible: true });
  });
});

describe('the Jira table', () => {
  it('is the Confluence Jira macro listing the work items with the chosen columns', () => {
    const node = jiraTableNode(['PAY-12', 'PAY-13'], ['key', 'summary', 'assignee', 'due', 'status'], ids());
    expect(node).toEqual({
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: 'jira',
        parameters: {
          macroParams: {
            server: { value: 'System Jira' },
            columns: { value: 'key,summary,assignee,due,status' },
            columnIds: { value: 'issuekey,summary,assignee,duedate,status' },
            maximumIssues: { value: '20' },
            jqlQuery: { value: 'key in (PAY-12,PAY-13) ORDER BY duedate ASC, key ASC' },
          },
          macroMetadata: { macroId: { value: 'id-1' }, schemaVersion: { value: '1' }, title: 'Jira Legacy' },
        },
        localId: 'id-2',
      },
    });
  });

  it('replaces only that table; the rest of the page is unchanged and has no typed facts left', () => {
    const before = doc(p('Weekly status'), statusTable(), p('PAY-12 ships Dec 3.'));
    const [t] = findLiveTables(before);
    const after = replaceWithJiraTable(before, t, ids());
    expect(after.content[0]).toEqual(before.content[0]);
    expect(after.content[2]).toEqual(before.content[2]);
    expect(after.content[1].attrs.extensionKey).toBe('jira');
    expect(before.content[1].type).toBe('table'); // input untouched
    expect(extractClaims(after).claims.map((c) => c.raw)).toEqual(['Dec 3']); // only the sentence remains
  });
});
