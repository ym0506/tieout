import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Text, Link, Lozenge, Spinner, SectionMessage, Strong,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { FIELD_LABEL, plural } from './shared.jsx';

/** In a Jira work item: the Confluence pages that quote it, and whether they are still right. */
export const IssuePanel = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('getCitations')
      .then((res) => (res && res.error ? setError(res.message) : setData(res)))
      .catch((e) => setError((e && e.message) || 'Tie-Out could not load.'));
  }, []);

  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Inline space="space.100" alignBlock="center"><Spinner size="small" label="Loading" /><Text>Looking for pages that quote this work item…</Text></Inline>;

  if (!data.pages.length) {
    return (
      <Text>
        No Confluence page that Tie-Out has indexed states facts about this work item.
        Pages are indexed when they are created, edited or scanned from the Tie-Out page in Confluence.
      </Text>
    );
  }

  const stale = data.pages.filter((p) => p.counts.drift > 0).length;
  return (
    <Stack space="space.150">
      <Text>
        <Strong>{`Quoted on ${plural(data.pages.length, 'page')}.`}</Strong>
        {stale ? ` ${plural(stale, 'page')} ${stale === 1 ? 'says' : 'say'} something this work item no longer says.` : ' All of them match this work item.'}
      </Text>
      {data.pages.map((p) => (
        <Stack key={p.id} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Link href={p.url || `/wiki/pages/viewpage.action?pageId=${p.id}`} openNewTab>{p.title}</Link>
            {p.counts.drift > 0
              ? <Lozenge appearance="removed">{`${p.counts.drift} out of date`}</Lozenge>
              : <Lozenge appearance="success">Matches</Lozenge>}
          </Inline>
          {p.claims.filter((c) => c.verdict === 'drift').map((c) => (
            <Text key={c.id} size="small">
              {`${FIELD_LABEL[c.field] || c.field}: page says "${c.raw}", this work item says "${c.actual ? c.actual.display : ''}"`}
            </Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <IssuePanel />
  </React.StrictMode>,
);
