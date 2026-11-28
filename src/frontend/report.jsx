import React, { useEffect, useState, useCallback } from 'react';
import {
  Stack, Inline, Text, Heading, SectionMessage, Spinner, LoadingButton, Button, Link, User, EmptyState, Box, xcss,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';
import { ClaimsTable, CountsLine, plural } from './shared.jsx';

const wrap = xcss({ padding: 'space.200' });

/** The full page report: what the page says, what Jira says, and one-click fixes. */
export const Report = ({ compact = false }) => {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [fixingId, setFixingId] = useState(null);
  const [fixed, setFixed] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [living, setLiving] = useState(null);
  const [liveDone, setLiveDone] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await invoke('getPageReport');
      if (res && res.error) setError(res.message || 'Tie-Out could not check this page.');
      else setReport(res);
    } catch (e) {
      setError((e && e.message) || 'Tie-Out could not check this page.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fix = async (claimIds, marker) => {
    setFixingId(marker);
    try {
      const res = await invoke('fixPage', { claimIds });
      if (res && res.error) setError(res.message);
      else {
        setFixed(res);
        await load();
      }
    } catch (e) {
      setError((e && e.message) || 'The page could not be updated.');
    }
    setFixingId(null);
  };

  const makeLive = async (table) => {
    setLiving(table.id);
    try {
      const res = await invoke('makeTableLive', { tableId: table.id, keys: table.keys });
      if (res && res.error) setError(res.message);
      else if (res && !res.done) setError(res.reason || 'The table could not be replaced.');
      else setLiveDone(res);
    } catch (e) {
      setError((e && e.message) || 'The table could not be replaced.');
    }
    setLiving(null);
    setConfirming(null);
  };

  if (error) {
    return (
      <Box xcss={wrap}>
        <SectionMessage appearance="error" title="Tie-Out could not finish">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }
  if (!report) {
    return (
      <Box xcss={wrap}>
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" label="Checking" />
          <Text>Checking this page against Jira…</Text>
        </Inline>
      </Box>
    );
  }

  const { counts, results, context } = report;
  const liveable = (report.liveTables || []).filter((t) => t.eligible);
  const fixable = results.filter((r) => r.verdict === 'drift' && r.fixable);

  if (!counts.total) {
    return (
      <Box xcss={wrap}>
        <EmptyState
          header="No checkable facts on this page"
          description="Tie-Out checks due dates, owners, statuses, fix versions and priorities that are written next to a Jira work item, in a table row or in the same sentence. Smart links and plain keys such as PAY-12 both count."
        />
      </Box>
    );
  }

  return (
    <Box xcss={wrap}>
      <Stack space="space.200">
        {!compact && <Heading as="h2" size="medium">Tie-Out</Heading>}
        <Inline space="space.200" alignBlock="center" spread="space-between">
          <CountsLine counts={counts} />
          {fixable.length > 1 && (
            <LoadingButton
              appearance="primary"
              isLoading={fixingId === 'all'}
              isDisabled={!!fixingId}
              onClick={() => fix(null, 'all')}
            >
              {`Update all ${fixable.length} on the page`}
            </LoadingButton>
          )}
        </Inline>

        {report.ignored && (
          <SectionMessage appearance="information" title="Background checks are off for this page">
            <Text>{`${report.ignoredFrom === 'parent' ? 'A page above this one' : 'This page'} has the label tieout-ignore, so this page gets no badge count or banner. You can still check it here. Remove the label to turn background checks back on.`}</Text>
          </SectionMessage>
        )}

        {fixed && fixed.applied && fixed.applied.length > 0 && (
          <SectionMessage appearance="success" title={`${plural(fixed.applied.length, 'fact')} updated on the page`}>
            <Stack space="space.100">
              <Text>The page was saved as a new version, so the change is in the page history and can be undone there.</Text>
              <Inline>
                <Button appearance="primary" onClick={() => router.reload()}>Reload the page</Button>
              </Inline>
            </Stack>
          </SectionMessage>
        )}

        {counts.drift > 0 && (
          <Text>
            {`${plural(counts.drift, 'fact')} on this page no longer ${counts.drift === 1 ? 'matches' : 'match'} Jira. Each one can be rewritten in place with the current value.`}
          </Text>
        )}

        <ClaimsTable results={results} onFix={(id) => fix([id], id)} fixingId={fixingId} disabled={!!fixingId} />

        {liveDone && (
          <SectionMessage appearance="success" title="The table now shows Jira's current values">
            <Stack space="space.100">
              <Text>{`The typed table of ${plural(liveDone.keys.length, 'work item')} was replaced with a Jira table and saved as a new page version, which can be undone from the page history.`}</Text>
              <Inline>
                <Button appearance="primary" onClick={() => router.reload()}>Reload the page</Button>
              </Inline>
            </Stack>
          </SectionMessage>
        )}

        {!liveDone && liveable.map((t) => (
          <SectionMessage key={t.id} appearance="information" title="Keep this table current">
            <Stack space="space.100">
              <Text>{`The table listing ${t.keys.slice(0, 3).join(', ')}${t.keys.length > 3 ? ` and ${t.keys.length - 3} more` : ''} can be replaced with a Jira table, which always shows Jira's current values. The typed values go away and the rows are sorted by ${t.columns && t.columns.includes('due') ? 'due date' : 'work item key'}. People who cannot open Jira will see an empty table.`}</Text>
              {confirming === t.id ? (
                <Inline space="space.100">
                  <LoadingButton appearance="primary" isLoading={living === t.id} isDisabled={!!living} onClick={() => makeLive(t)}>Replace with a live Jira table</LoadingButton>
                  <Button appearance="subtle" onClick={() => setConfirming(null)}>Cancel</Button>
                </Inline>
              ) : (
                <Inline>
                  <Button onClick={() => setConfirming(t.id)}>Make this table live</Button>
                </Inline>
              )}
            </Stack>
          </SectionMessage>
        ))}

        {context && (context.owners.length > 0 || context.linked.length > 0) && (
          <SectionMessage appearance="information" title="Who and what else is affected (from Teamwork Graph)">
            <Stack space="space.100">
              {context.owners.length > 0 && (
                <Inline space="space.100" alignBlock="center">
                  <Text>Page owner:</Text>
                  {context.owners.map((o) => <User key={o.accountId} accountId={o.accountId} />)}
                </Inline>
              )}
              {context.linked.length > 0 && (
                <Stack space="space.050">
                  <Text>Pages linked from here, which may repeat the same facts:</Text>
                  {context.linked.slice(0, 6).map((l) => (
                    <Inline key={l.id} space="space.100" alignBlock="center">
                      <Link href={`/wiki/pages/viewpage.action?pageId=${l.id}`} openNewTab>{l.title}</Link>
                      {l.counts && l.counts.drift > 0 ? <Text size="small">{`${l.counts.drift} out of date`}</Text> : null}
                    </Inline>
                  ))}
                </Stack>
              )}
            </Stack>
          </SectionMessage>
        )}

        <Text size="small">
          Checked against Jira just now, with your permissions. Tie-Out compares field values by rule; it does not use an AI model to decide.
        </Text>
      </Stack>
    </Box>
  );
};
