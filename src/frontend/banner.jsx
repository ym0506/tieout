import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Inline, Text, Button, LoadingButton, Strong, Modal, ModalTransition, ModalHeader, ModalTitle, ModalBody, ModalFooter,
} from '@forge/react';
import { invoke, view, router } from '@forge/bridge';
import { Report } from './report.jsx';
import { noticeStyle, plural } from './shared.jsx';

/** Shown at the top of a page only when stored counts say something on it is out of date. */
export const Banner = () => {
  const [summary, setSummary] = useState(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    invoke('getPageSummary')
      .then((s) => {
        if (!alive) return;
        if (!s || s.error || !s.counts || !s.counts.drift) view.close();
        else setSummary(s);
      })
      .catch(() => view.close());
    return () => { alive = false; };
  }, []);

  if (!summary) return null;

  const updateAll = async () => {
    setBusy(true);
    try {
      const res = await invoke('fixPage', { claimIds: null });
      if (res && !res.error && res.applied && res.applied.length) {
        setDone(res.applied.length);
        router.reload();
      } else {
        setOpen(true);
      }
    } catch (e) {
      setOpen(true);
    }
    setBusy(false);
  };

  const n = summary.counts.drift;
  return (
    <Box xcss={noticeStyle}>
      <Inline spread="space-between" alignBlock="center" space="space.200">
        <Text>
          <Strong>{`${plural(n, 'fact')} on this page no longer ${n === 1 ? 'matches' : 'match'} Jira.`}</Strong>
          {done ? ` ${plural(done, 'fact')} updated, reloading…` : ' Readers and AI assistants will repeat what is written here.'}
        </Text>
        <Inline space="space.100">
          <Button onClick={() => setOpen(true)}>Review</Button>
          <LoadingButton appearance="primary" isLoading={busy} onClick={updateAll}>Update from Jira</LoadingButton>
          <Button appearance="subtle" onClick={() => view.close()}>Dismiss</Button>
        </Inline>
      </Inline>
      <ModalTransition>
        {open && (
          <Modal onClose={() => setOpen(false)} width="x-large">
            <ModalHeader>
              <ModalTitle>Tie-Out</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Report compact />
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Banner />
  </React.StrictMode>,
);
