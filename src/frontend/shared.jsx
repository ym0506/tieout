import React from 'react';
import {
  Box, Inline, Stack, Text, Lozenge, Link, DynamicTable, LoadingButton, Strong, xcss,
} from '@forge/react';

export const FIELD_LABEL = {
  due: 'Due date',
  assignee: 'Owner',
  status: 'Status',
  fixVersion: 'Fix version',
  priority: 'Priority',
};

const VERDICT = {
  drift: { label: 'Out of date', appearance: 'removed' },
  match: { label: 'Matches Jira', appearance: 'success' },
  unverifiable: { label: 'Not checked', appearance: 'default' },
};

export const VerdictLozenge = ({ verdict }) => {
  const v = VERDICT[verdict] || VERDICT.unverifiable;
  return <Lozenge appearance={v.appearance}>{v.label}</Lozenge>;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

/** "True until Nov 6, 2026 · changed by Jiyoung Park" */
export function historyLine(history) {
  if (!history) return '';
  if (history.wasTrueUntil) return `True until ${shortDate(history.wasTrueUntil)} · changed by ${history.changedBy}`;
  if (history.changedAt) return `Last changed ${shortDate(history.changedAt)} by ${history.changedBy}`;
  return '';
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

const ORDER = { drift: 0, unverifiable: 1, match: 2 };

export function sortResults(results) {
  return [...(results || [])].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.issueKey.localeCompare(b.issueKey));
}

export const CountsLine = ({ counts }) => (
  <Inline space="space.100" alignBlock="center">
    {counts.drift > 0 && <Lozenge appearance="removed" isBold>{`${counts.drift} out of date`}</Lozenge>}
    <Lozenge appearance="success">{`${counts.match} match Jira`}</Lozenge>
    {counts.unverifiable > 0 && <Lozenge>{`${counts.unverifiable} not checked`}</Lozenge>}
  </Inline>
);

/**
 * One row per fact found on the page.
 * @param {{results: object[], onFix?: (id: string) => void, fixingId?: string|null, disabled?: boolean}} props
 */
export const ClaimsTable = ({ results, onFix, fixingId, disabled }) => {
  const head = {
    cells: [
      { key: 'item', content: 'Work item' },
      { key: 'field', content: 'Fact' },
      { key: 'page', content: 'Page says' },
      { key: 'jira', content: 'Jira says' },
      { key: 'verdict', content: 'Result' },
      ...(onFix ? [{ key: 'action', content: '' }] : []),
    ],
  };
  const rows = sortResults(results).map((r) => ({
    key: r.id,
    cells: [
      {
        key: 'item',
        content: (
          <Stack space="space.0">
            <Link href={`/browse/${r.issueKey}`} openNewTab>{r.issueKey}</Link>
            {r.summary ? <Text size="small">{r.summary}</Text> : null}
          </Stack>
        ),
      },
      { key: 'field', content: <Text>{FIELD_LABEL[r.field] || r.field}</Text> },
      { key: 'page', content: <Text>{r.raw}</Text> },
      {
        key: 'jira',
        content: (
          <Stack space="space.0">
            <Text>{r.actual ? <Strong>{r.actual.display}</Strong> : 'No access'}</Text>
            {r.verdict === 'drift' && historyLine(r.history) ? <Text size="small">{historyLine(r.history)}</Text> : null}
            {r.verdict === 'unverifiable' && r.reason ? <Text size="small">{r.reason}</Text> : null}
          </Stack>
        ),
      },
      { key: 'verdict', content: <VerdictLozenge verdict={r.verdict} /> },
      ...(onFix ? [{
        key: 'action',
        content: r.verdict === 'drift' && r.fixable ? (
          <LoadingButton
            spacing="compact"
            isLoading={fixingId === r.id}
            isDisabled={disabled}
            onClick={() => onFix(r.id)}
          >
            {`Write "${r.replacement}"`}
          </LoadingButton>
        ) : (r.verdict === 'drift' ? <Text size="small">Edit by hand</Text> : null),
      }] : []),
    ],
  }));
  return <DynamicTable head={head} rows={rows} emptyView="Nothing to show." />;
};

export const noticeStyle = xcss({
  backgroundColor: 'color.background.warning',
  padding: 'space.150',
  borderRadius: 'border.radius',
});

export const tileStyle = xcss({
  backgroundColor: 'elevation.surface.sunken',
  padding: 'space.200',
  borderRadius: 'border.radius',
  minWidth: '140px',
});

export const Tile = ({ label, value }) => (
  <Box xcss={tileStyle}>
    <Stack space="space.050">
      <Text size="small">{label}</Text>
      <Text size="large" weight="bold">{String(value)}</Text>
    </Stack>
  </Box>
);
