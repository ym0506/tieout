import { describe, it, expect } from 'vitest';
import {
  extractClaims, evaluate, countVerdicts, applyFixes, textToAdf, explainDrift, reduceIssue, keyFromUrl, fieldsOfHeader,
} from '../src/engine/index.js';
import {
  doc, p, card, date, mention, status, cell, th, row, table, issue, link, text, byId,
} from './helpers.js';

const run = (d, issues, opts) => {
  const ex = extractClaims(d);
  const origins = Object.fromEntries(ex.mentions.map((m) => [m.key, m.origin]));
  return { ex, results: evaluate(ex.claims, issues, { origins, ...opts }) };
};

describe('status table (header row)', () => {
  const page = doc(
    p('Weekly status'),
    table(
      row(th('Work item'), th('Owner'), th('Due'), th('Status'), th('Notes')),
      row(cell(card('PAY-12')), cell('Minsu Kim'), cell('Dec 3'), cell('In Progress'), cell('waiting on legal')),
      row(cell(card('PAY-13')), cell(mention('acc-jiyoung', 'Jiyoung Park')), cell(date('2026-12-17')), cell(status('DONE', 'green')), cell('')),
      row(cell('PAY-14'), cell('TBD'), cell('-'), cell('To Do'), cell('')),
    ),
  );
  const issues = {
    'PAY-12': issue('PAY-12'),
    'PAY-13': issue('PAY-13', { status: { name: 'Done', category: 'done' } }),
    'PAY-14': issue('PAY-14', { status: { name: 'To Do', category: 'new' }, assignee: null, duedate: null }),
  };

  it('finds one claim per mapped cell and skips placeholders', () => {
    const { ex } = run(page, issues);
    expect(ex.issueKeys.sort()).toEqual(['PAY-12', 'PAY-13', 'PAY-14']);
    expect(ex.claims.map((c) => c.id)).toEqual([
      'PAY-12|assignee|1', 'PAY-12|due|1', 'PAY-12|status|1',
      'PAY-13|assignee|1', 'PAY-13|due|1', 'PAY-13|status|1',
      'PAY-14|status|1',
    ]);
  });

  it('judges each cell against Jira', () => {
    const { results } = run(page, issues);
    const r = byId(results);
    expect(r['PAY-12|assignee|1'].verdict).toBe('drift');
    expect(r['PAY-12|assignee|1'].replacement).toBe('Jiyoung Park');
    expect(r['PAY-12|due|1'].verdict).toBe('drift');
    expect(r['PAY-12|due|1'].replacement).toBe('Dec 17');
    expect(r['PAY-12|status|1'].verdict).toBe('match');
    expect(r['PAY-13|assignee|1'].verdict).toBe('match');
    expect(r['PAY-13|due|1'].verdict).toBe('match');
    expect(r['PAY-13|status|1'].verdict).toBe('match');
    expect(r['PAY-14|status|1'].verdict).toBe('match');
    expect(countVerdicts(results)).toEqual({ total: 7, match: 5, drift: 2, unverifiable: 0 });
  });

  it('fixes drifted cells in place and nothing else', () => {
    const { results } = run(page, issues);
    const { doc: fixed, applied, skipped } = applyFixes(page, results);
    expect(applied.sort()).toEqual(['PAY-12|assignee|1', 'PAY-12|due|1']);
    expect(skipped).toEqual([]);
    const after = run(fixed, issues).results;
    expect(countVerdicts(after)).toEqual({ total: 7, match: 7, drift: 0, unverifiable: 0 });
    // untouched cells are byte-identical
    expect(fixed.content[1].content[2]).toEqual(page.content[1].content[2]);
    expect(fixed.content[0]).toEqual(page.content[0]);
    // the original document was not mutated
    expect(page.content[1].content[1].content[2].content[0].content[0].text).toBe('Dec 3');
  });

  it('fixes date, mention and status nodes', () => {
    const changed = {
      ...issues,
      'PAY-13': issue('PAY-13', { duedate: '2027-01-05', assignee: { accountId: 'acc-minsu', displayName: 'Minsu Kim' }, status: { name: 'In Review', category: 'indeterminate' } }),
    };
    const { results } = run(page, changed);
    const { doc: fixed, applied } = applyFixes(page, results);
    expect(applied).toContain('PAY-13|due|1');
    const cells = fixed.content[1].content[2].content;
    expect(cells[1].content[0].content[0]).toMatchObject({ type: 'mention', attrs: { id: 'acc-minsu', text: '@Minsu Kim' } });
    expect(cells[2].content[0].content[0].attrs.timestamp).toBe(String(Date.UTC(2027, 0, 5)));
    expect(cells[3].content[0].content[0]).toMatchObject({ type: 'status', attrs: { text: 'In Review', color: 'blue' } });
    expect(countVerdicts(run(fixed, changed).results).drift).toBe(0);
  });

  it('marks vague dates as unverifiable instead of guessing', () => {
    const vague = doc(table(
      row(th('Epic'), th('Target date')),
      row(cell(card('PAY-12')), cell('early Q1')),
    ));
    const { results } = run(vague, issues);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ verdict: 'unverifiable', field: 'due' });
    expect(results[0].reason).toMatch(/not a specific date/);
  });

  it('ignores rows that mention two work items', () => {
    const two = doc(table(
      row(th('Work item'), th('Due')),
      row(cell(card('PAY-12'), ' and ', card('PAY-13')), cell('Dec 3')),
    ));
    expect(run(two, issues).ex.claims).toEqual([]);
  });

  it('reads a "Release" column as a date or a version, whichever it holds', () => {
    const rel = doc(table(
      row(th('Key'), th('Release')),
      row(cell('PAY-12'), cell('v2.4.0')),
      row(cell('PAY-13'), cell('Dec 17, 2026')),
    ));
    const r = byId(run(rel, issues).results);
    expect(r['PAY-12|fixVersion|1'].verdict).toBe('match');
    expect(r['PAY-13|due|1'].verdict).toBe('match');
  });
});

describe('page-properties table (header column)', () => {
  const page = doc(table(
    row(th('Epic'), cell(card('PAY-12'))),
    row(th('Owner'), cell('Minsu')),
    row(th('Target date'), cell('2026-12-03')),
    row(th('Status'), cell(status('IN PROGRESS', 'blue'))),
    row(th('Budget'), cell('$40k')),
  ));

  it('ties every row to the single work item in the table', () => {
    const { results } = run(page, { 'PAY-12': issue('PAY-12') });
    const r = byId(results);
    expect(Object.keys(r).sort()).toEqual(['PAY-12|assignee|1', 'PAY-12|due|1', 'PAY-12|status|1']);
    expect(r['PAY-12|assignee|1'].verdict).toBe('drift');
    expect(r['PAY-12|due|1']).toMatchObject({ verdict: 'drift', replacement: '2026-12-17' });
    expect(r['PAY-12|status|1'].verdict).toBe('match');
  });
});

describe('sentences', () => {
  const issues = { 'PAY-12': issue('PAY-12'), 'PAY-13': issue('PAY-13', { duedate: '2026-12-10' }) };

  it('reads a due date with a cue word', () => {
    const { results } = run(doc(p(card('PAY-12'), ' ships Dec 3 and is owned by Minsu Kim.')), issues);
    const r = byId(results);
    expect(r['PAY-12|due|1']).toMatchObject({ verdict: 'drift', raw: 'Dec 3', replacement: 'Dec 17' });
    expect(r['PAY-12|assignee|1']).toMatchObject({ verdict: 'drift', raw: 'Minsu Kim' });
  });

  it('keeps a comma-year date in one piece and splits clauses per work item', () => {
    const { results } = run(doc(p('PAY-12 is due December 17, 2026, and PAY-13 is due December 3, 2026.')), issues);
    const r = byId(results);
    expect(r['PAY-12|due|1'].verdict).toBe('match');
    expect(r['PAY-13|due|1']).toMatchObject({ verdict: 'drift', replacement: 'December 10, 2026' });
  });

  it('takes the new date when the sentence describes a move', () => {
    const { results } = run(doc(p('PAY-12 slipped from Dec 3 to Dec 17.')), issues);
    expect(byId(results)['PAY-12|due|1']).toMatchObject({ verdict: 'match', raw: 'Dec 17' });
  });

  it('does not treat past events or "as of" dates as due dates', () => {
    const d = doc(
      p('PAY-12 was fixed by Alice on Dec 3.'),
      p('As of Nov 20, PAY-12 is in progress.'),
      p('PAY-12 was created on Nov 1 and updated Nov 5.'),
    );
    const { results } = run(d, issues);
    expect(results.filter((x) => x.field === 'due')).toEqual([]);
    expect(results.filter((x) => x.field === 'status').map((x) => x.verdict)).toEqual(['match']);
  });

  it('reads status wording and lozenges', () => {
    const d = doc(
      p('PAY-12 is now done.'),
      p(card('PAY-13'), ' ', status('IN PROGRESS', 'blue')),
      p('PAY-12 (blocked) needs a decision.'),
    );
    const r = byId(run(d, issues).results);
    expect(r['PAY-12|status|1']).toMatchObject({ verdict: 'drift', raw: 'done' });
    expect(r['PAY-13|status|1'].verdict).toBe('match');
    expect(r['PAY-12|status|2'].verdict).toBe('unverifiable');
  });

  it('reads versions and Korean sentences', () => {
    const d = doc(
      p('PAY-12 ships in v2.5.0.'),
      p('PAY-13 담당자는 박지영, 12월 3일까지 출시 예정.'),
    );
    const r = byId(run(d, issues).results);
    expect(r['PAY-12|fixVersion|1']).toMatchObject({ verdict: 'drift', replacement: '2.4.0' });
    expect(r['PAY-13|due|1']).toMatchObject({ verdict: 'drift', replacement: '12월 10일' });
    expect(r['PAY-13|assignee|1'].raw).toBe('박지영');
  });

  it('says nothing when a sentence has no cue', () => {
    const d = doc(p('We discussed PAY-12 with Minsu on Dec 3 over lunch.'));
    expect(run(d, issues).results).toEqual([]);
  });

  it('follows links whose text is not the key', () => {
    const d = doc(p(link('the payments epic', 'https://acme.atlassian.net/browse/PAY-12'), ' is due Dec 3.'));
    const { ex, results } = run(d, issues);
    expect(ex.mentions).toEqual([{ key: 'PAY-12', origin: 'link' }]);
    expect(results[0]).toMatchObject({ issueKey: 'PAY-12', verdict: 'drift' });
  });

  it('cannot auto-fix a date split across formatting, but still reports it', () => {
    const d = doc(p('PAY-12 is due ', text('Dec', [{ type: 'strong' }]), ' 3.'));
    const { results } = run(d, issues);
    expect(results[0]).toMatchObject({ verdict: 'drift', fixable: false });
    expect(applyFixes(d, results).skipped).toEqual(['PAY-12|due|1']);
  });

  it('refuses a fix when the text changed since the check', () => {
    const d = doc(p('PAY-12 is due Dec 3.'));
    const { results } = run(d, issues);
    const edited = doc(p('PAY-12 is due Jan 9.'));
    const { applied, skipped } = applyFixes(edited, results);
    expect(applied).toEqual([]);
    expect(skipped).toEqual(['PAY-12|due|1']);
  });
});

describe('keys that are not work items', () => {
  it('drops text-only keys Jira does not know, like UTF-8', () => {
    const d = doc(p('The export is UTF-8 and is due Dec 3.'), p('SHA-256 is now done.'));
    const { ex, results } = run(d, {});
    expect(ex.issueKeys.sort()).toEqual(['SHA-256', 'UTF-8']);
    expect(results).toEqual([]);
  });

  it('reports a smart link Jira will not show as unverifiable', () => {
    const d = doc(p(card('SEC-9'), ' is due Dec 3.'));
    const { results } = run(d, {});
    expect(results[0]).toMatchObject({ verdict: 'unverifiable', issueKey: 'SEC-9' });
    expect(results[0].actual).toBe(null);
  });

  it('does not read a version such as FLINK-2.4 as a work item key', () => {
    const d = doc(table(row(th('JIRA'), cell(card('FLINK-41336'))), row(th('Release'), cell('FLINK-2.4'))));
    const ex = extractClaims(d);
    expect(ex.issueKeys).toEqual(['FLINK-41336']);
    expect(ex.claims.map((c) => [c.issueKey, c.field, c.raw])).toEqual([['FLINK-41336', 'fixVersion', 'FLINK-2.4']]);
  });

  it('treats unfilled template slots as saying nothing', () => {
    const d = doc(table(row(th('JIRA'), cell(card('FLINK-1'))), row(th('Release'), cell('<Flink Version>')), row(th('Owner'), cell('[name]')), row(th('Status'), cell('—'))));
    expect(extractClaims(d).claims).toEqual([]);
  });

  it('does not take words in a Release cell for a version', () => {
    const d = doc(table(row(th('JIRA'), cell(card('PAY-12'))), row(th('Release'), cell('To be created'))));
    const { results } = run(d, { 'PAY-12': issue('PAY-12', { fixVersions: [] }) });
    expect(results[0]).toMatchObject({ field: 'fixVersion', verdict: 'unverifiable' });
  });

  it('skips code blocks', () => {
    const d = doc({ type: 'codeBlock', content: [text('PAY-12 is due Dec 3')] });
    expect(extractClaims(d).claims).toEqual([]);
  });
});

describe('helpers', () => {
  it('keyFromUrl', () => {
    expect(keyFromUrl('https://a.atlassian.net/browse/PAY-12')).toBe('PAY-12');
    expect(keyFromUrl('https://a.atlassian.net/jira/software/projects/PAY/boards/1?selectedIssue=PAY-12')).toBe('PAY-12');
    expect(keyFromUrl('https://example.com/x')).toBe(null);
  });

  it('fieldsOfHeader', () => {
    expect(fieldsOfHeader('Owner')).toEqual(['assignee']);
    expect(fieldsOfHeader('📅 Due date')).toEqual(['due']);
    expect(fieldsOfHeader('담당자')).toEqual(['assignee']);
    expect(fieldsOfHeader('Notes')).toBe(null);
    expect(fieldsOfHeader('Date')).toBe(null);
  });

  it('reduceIssue flattens the Jira REST shape', () => {
    const r = reduceIssue({
      key: 'PAY-1',
      fields: {
        summary: 'S', duedate: '2026-12-17', assignee: { accountId: 'a', displayName: 'A B' },
        status: { name: 'Done', statusCategory: { key: 'done' } }, fixVersions: [{ name: '1.0' }], priority: { name: 'High' },
      },
    });
    expect(r).toEqual({
      key: 'PAY-1', found: true, summary: 'S', duedate: '2026-12-17', assignee: { accountId: 'a', displayName: 'A B' },
      status: { name: 'Done', category: 'done' }, fixVersions: ['1.0'], priority: 'High',
    });
    expect(reduceIssue({ key: 'PAY-2', fields: {} })).toMatchObject({ assignee: null, duedate: null, fixVersions: [], priority: null });
  });
});

describe('agent drafts (plain text and Markdown)', () => {
  const issues = { 'PAY-12': issue('PAY-12'), 'PAY-13': issue('PAY-13', { status: { name: 'Done', category: 'done' } }) };

  it('checks a Markdown status table', () => {
    const draft = [
      '## Payments update',
      '',
      '| Work item | Owner | Due | Status |',
      '|---|---|---|---|',
      '| PAY-12 | Minsu | Dec 3 | In progress |',
      '| [Refunds](https://acme.atlassian.net/browse/PAY-13) | Jiyoung | Dec 17 | In progress |',
    ].join('\n');
    const r = byId(run(textToAdf(draft), issues).results);
    expect(r['PAY-12|assignee|1'].verdict).toBe('drift');
    expect(r['PAY-12|due|1'].verdict).toBe('drift');
    expect(r['PAY-12|status|1'].verdict).toBe('match');
    expect(r['PAY-13|assignee|1'].verdict).toBe('match');
    expect(r['PAY-13|status|1'].verdict).toBe('drift');
  });

  it('checks bullet points', () => {
    const draft = '- **PAY-12** ships Dec 17, owner: Jiyoung Park\n- PAY-13 is still in progress';
    const r = byId(run(textToAdf(draft), issues).results);
    expect(r['PAY-12|due|1'].verdict).toBe('match');
    expect(r['PAY-12|assignee|1'].verdict).toBe('match');
    expect(r['PAY-13|status|1'].verdict).toBe('drift');
  });
});

describe('explainDrift', () => {
  const histories = [
    { created: '2026-11-06T09:00:00.000+0000', author: { displayName: 'Jiyoung Park' }, items: [{ field: 'duedate', from: '2026-12-03', fromString: '2026-12-03 00:00:00.0', to: '2026-12-17', toString: '2026-12-17 00:00:00.0' }] },
    { created: '2026-11-02T09:00:00.000+0000', author: { displayName: 'Lead' }, items: [{ field: 'assignee', from: 'acc-minsu', fromString: 'Minsu Kim', to: 'acc-jiyoung', toString: 'Jiyoung Park' }] },
    { created: '2026-10-01T09:00:00.000+0000', author: { displayName: 'Lead' }, items: [{ field: 'status', from: '1', fromString: 'To Do', to: '3', toString: 'In Progress' }] },
  ];
  const { results } = run(doc(p('PAY-12 ships Dec 3, owner: Minsu Kim. PAY-12 is now to do.')), { 'PAY-12': issue('PAY-12') });
  const r = byId(results);

  it('says when the page stopped being true', () => {
    expect(explainDrift(r['PAY-12|due|1'], histories)).toMatchObject({ wasTrueUntil: '2026-11-06T09:00:00.000+0000', changedBy: 'Jiyoung Park' });
    expect(explainDrift(r['PAY-12|assignee|1'], histories)).toMatchObject({ wasTrueUntil: '2026-11-02T09:00:00.000+0000', from: 'Minsu Kim', to: 'Jiyoung Park' });
    expect(explainDrift(r['PAY-12|status|1'], histories)).toMatchObject({ wasTrueUntil: '2026-10-01T09:00:00.000+0000' });
  });

  it('falls back to the latest change when the page was never true', () => {
    const never = run(doc(p('PAY-12 is due Jan 9.')), { 'PAY-12': issue('PAY-12') }).results[0];
    expect(explainDrift(never, histories)).toMatchObject({ wasTrueUntil: null, changedAt: '2026-11-06T09:00:00.000+0000' });
    expect(explainDrift(never, [])).toBe(null);
  });
});
