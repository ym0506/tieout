import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Text, Heading, Button, LoadingButton, Link, Lozenge, DynamicTable, SectionMessage, Select, Spinner, EmptyState, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { Tile, plural, shortDate } from './shared.jsx';

const page = xcss({ padding: 'space.300', maxWidth: '1100px' });
const MAX_BATCHES_PER_CLICK = 6;

const pageUrl = (id) => `/wiki/pages/viewpage.action?pageId=${id}`;
const ANY_PROJECT = { label: 'Any project', value: '' };
const TYPE_NAME = { business: 'business', software: 'software', service_desk: 'service', product_discovery: 'discovery' };

/** Site overview: how many pages state Jira facts, which are out of date, plus scan and sample tools. */
export const Dashboard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const [spaces, setSpaces] = useState(null);
  const [space, setSpace] = useState(null);
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState(ANY_PROJECT);
  const [creating, setCreating] = useState(false);
  const [sample, setSample] = useState(null);
  const [sampleError, setSampleError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await invoke('getDashboard');
      if (res && res.error) setError(res.message);
      else setData(res);
    } catch (e) {
      setError((e && e.message) || 'Tie-Out could not load.');
    }
  }, []);

  useEffect(() => {
    load();
    invoke('listSpaces')
      .then((res) => {
        const list = (res && res.spaces) || [];
        setSpaces(list);
        if (list.length) setSpace({ label: list[0].name, value: list[0].id });
      })
      .catch(() => setSpaces([]));
    invoke('listProjects')
      .then((res) => setProjects((res && res.projects) || []))
      .catch(() => setProjects([]));
  }, [load]);

  const scan = async (restart) => {
    setScanning(true);
    setScanNote(null);
    let total = 0;
    let finished = false;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_CLICK && !finished; i += 1) {
        const res = await invoke('scan', { restart: restart && i === 0 });
        if (res && res.error) { setError(res.message); break; }
        total += res.scanned;
        finished = res.finished;
        setScanNote(`${plural(total, 'page')} read so far…`);
      }
      setScanNote(finished
        ? `Scan complete: ${plural(total, 'page')} read in this run.`
        : `${plural(total, 'page')} read. Press "Continue scan" for the next batch.`);
      await load();
    } catch (e) {
      setError((e && e.message) || 'The scan stopped.');
    }
    setScanning(false);
  };

  const createSample = async () => {
    if (!space) return;
    setCreating(true);
    setSample(null);
    setSampleError(null);
    try {
      const chosen = project && project.value ? { key: project.value, name: project.name } : null;
      const res = await invoke('createSample', { spaceId: space.value, project: chosen });
      if (res && res.error) setSampleError(res.message);
      else { setSample(res); await load(); }
    } catch (e) {
      setSampleError((e && e.message) || 'The sample page could not be created.');
    }
    setCreating(false);
  };

  if (error) {
    return (
      <Box xcss={page}>
        <SectionMessage appearance="error" title="Tie-Out could not finish">
          <Stack space="space.100">
            <Text>{error}</Text>
            <Inline><Button onClick={() => { setError(null); load(); }}>Try again</Button></Inline>
          </Stack>
        </SectionMessage>
      </Box>
    );
  }
  if (!data) return <Box xcss={page}><Spinner size="medium" label="Loading" /></Box>;

  const { totals, pages, scan: scanState } = data;
  const midScan = scanState && !scanState.finished && scanState.cursor;

  const head = {
    cells: [
      { key: 'title', content: 'Page', isSortable: false },
      { key: 'drift', content: 'Out of date' },
      { key: 'match', content: 'Match Jira' },
      { key: 'other', content: 'Not checked' },
      { key: 'items', content: 'Work items' },
      { key: 'checked', content: 'Last checked' },
    ],
  };
  const rows = pages.map((p) => ({
    key: p.id,
    cells: [
      { key: 'title', content: <Link href={pageUrl(p.id)} openNewTab>{p.title || `Page ${p.id}`}</Link> },
      { key: 'drift', content: p.counts.drift ? <Lozenge appearance="removed" isBold>{String(p.counts.drift)}</Lozenge> : <Text>0</Text> },
      { key: 'match', content: <Text>{String(p.counts.match)}</Text> },
      { key: 'other', content: <Text>{String(p.counts.unverifiable)}</Text> },
      { key: 'items', content: <Text>{p.issueKeys.slice(0, 4).join(', ')}{p.issueKeys.length > 4 ? ` +${p.issueKeys.length - 4}` : ''}</Text> },
      { key: 'checked', content: <Text>{shortDate(p.checkedAt)}</Text> },
    ],
  }));

  return (
    <Box xcss={page}>
      <Stack space="space.300">
        <Stack space="space.100">
          <Heading as="h1" size="large">Tie-Out</Heading>
          <Text>
            Pages state facts about Jira work items: due dates, owners, statuses. When Jira changes, the page stays as it was.
            Tie-Out checks those facts against Jira and shows which ones are no longer true.
          </Text>
        </Stack>

        <Inline space="space.200" shouldWrap>
          <Tile label="Pages stating Jira facts" value={totals.pages} />
          <Tile label="Pages out of date" value={totals.driftedPages} />
          <Tile label="Facts checked" value={totals.claims} />
          <Tile label="Facts out of date" value={totals.drift} />
          <Tile label="Facts matching Jira" value={totals.match} />
        </Inline>

        <Stack space="space.100">
          <Heading as="h2" size="small">Index your pages</Heading>
          <Text>
            New and edited pages are indexed automatically, and a page is checked again a few seconds after a work item it quotes changes.
            Scan to bring in pages that existed before Tie-Out was installed. Only counts and work item keys are stored, never field values.
          </Text>
          <Inline space="space.100" alignBlock="center">
            <LoadingButton appearance="primary" isLoading={scanning} onClick={() => scan(!midScan)}>
              {midScan ? 'Continue scan' : 'Scan pages'}
            </LoadingButton>
            {midScan ? <Button isDisabled={scanning} onClick={() => scan(true)}>Start over</Button> : null}
            {scanNote ? <Text>{scanNote}</Text> : null}
          </Inline>
        </Stack>

        <Stack space="space.100">
          <Heading as="h2" size="small">Try it on your own data</Heading>
          <Text>
            Creates a status page from Jira work items with a due date and an owner, from the project you choose. A few facts are written out of date on purpose, and the page says which.
          </Text>
          <Inline space="space.100" alignBlock="center">
            <Box xcss={xcss({ minWidth: '260px' })}>
              <Select
                inputId="tieout-space"
                placeholder={spaces === null ? 'Loading spaces…' : 'Choose a space'}
                options={(spaces || []).map((s) => ({ label: s.name, value: s.id }))}
                value={space}
                onChange={(v) => setSpace(v)}
              />
            </Box>
            <Box xcss={xcss({ minWidth: '260px' })}>
              <Select
                inputId="tieout-project"
                placeholder={projects === null ? 'Loading projects…' : 'Any project'}
                options={[ANY_PROJECT, ...(projects || []).map((p) => ({ label: `${p.name} (${p.key}${TYPE_NAME[p.type] ? `, ${TYPE_NAME[p.type]}` : ''})`, value: p.key, name: p.name }))]}
                value={project}
                onChange={(v) => setProject(v || ANY_PROJECT)}
              />
            </Box>
            <LoadingButton isLoading={creating} isDisabled={!space} onClick={createSample}>Create sample page</LoadingButton>
          </Inline>
          {sampleError && (
            <SectionMessage appearance="warning" title="No sample page created">
              <Text>{sampleError}</Text>
            </SectionMessage>
          )}
          {sample && sample.page && (
            <SectionMessage appearance="success" title="Sample page created">
              <Stack space="space.050">
                <Text>{`Built from ${sample.used.join(', ')}. ${sample.count || sample.stale.length} out of date on purpose: ${sample.stale.join(', ')}${sample.count > sample.stale.length ? ' (the due date is written twice)' : ''}.`}</Text>
                <Link href={sample.page.url || pageUrl(sample.page.id)} openNewTab>Open the sample page</Link>
              </Stack>
            </SectionMessage>
          )}
        </Stack>

        <Stack space="space.100">
          <Heading as="h2" size="small">Pages</Heading>
          {pages.length ? (
            <DynamicTable head={head} rows={rows} rowsPerPage={20} />
          ) : (
            <EmptyState
              header="No pages indexed yet"
              description="Scan your pages or create the sample page above. Pages that state facts about Jira work items will be listed here, most out of date first."
            />
          )}
        </Stack>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
