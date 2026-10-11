import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import type { ReactNode } from 'react';
import type { JuryState } from './jury-state';
import {
  IDLE_JURY,
  isJuryBusy,
  jobErrorCodeOf,
  juryAtomFamily,
  readStoredJury,
  reviewOfJob,
  storeJury,
} from './jury-state';
import { useDesignJobQuery } from '../../api/queries';
import { designErrorCode } from '../../api/errors';
import { reviewApi } from '../../api/review';

export interface JuryControls {
  enabled: boolean;
  state: JuryState;
  busy: boolean;
  reviewPath: string | null;
  start: (path: string) => void;
}

const disabledJury: JuryControls = {
  enabled: false,
  state: IDLE_JURY,
  busy: false,
  reviewPath: null,
  start: () => undefined,
};

const JuryContext = createContext<JuryControls>(disabledJury);

export function JuryProvider({
  projectId,
  enabled,
  reviewPath,
  children,
}: {
  projectId: string;
  enabled: boolean;
  reviewPath: string | null;
  children: ReactNode;
}) {
  const [state, setState] = useAtom(juryAtomFamily(projectId));
  const runningJob = state.status === 'running' ? state.jobId : null;
  const job = useDesignJobQuery(runningJob, { enabled });
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setState((current) => {
      if (current.status !== 'idle') {
        return current;
      }
      const stored = readStoredJury(projectId);
      return stored ? { status: 'running', ...stored } : current;
    });
  }, [enabled, projectId, setState]);

  useEffect(() => {
    if (state.status !== 'running') {
      return;
    }
    const { path } = state;
    if (job.data?.status === 'succeeded') {
      const review = reviewOfJob(job.data);
      if (!review) {
        storeJury(projectId, null);
      }
      setState(
        review
          ? { status: 'done', path: review.path, review }
          : { status: 'failed', path, code: null },
      );
    } else if (job.data?.status === 'failed') {
      storeJury(projectId, null);
      setState({ status: 'failed', path, code: jobErrorCodeOf(job.data) });
    } else if (job.error) {
      storeJury(projectId, null);
      setState({ status: 'failed', path, code: designErrorCode(job.error) });
    }
  }, [job.data, job.error, projectId, setState, state]);

  const start = useCallback(
    async (path: string) => {
      if (!enabled || inFlight.current) {
        return;
      }
      inFlight.current = true;
      setState({ status: 'requesting', path });
      try {
        const outcome = await reviewApi.request(projectId, { path });
        if (outcome.status === 'succeeded') {
          const { status: _status, ...review } = outcome;
          storeJury(projectId, { jobId: review.jobId, path: review.path });
          setState({ status: 'done', path: review.path, review });
        } else if (outcome.status === 'running') {
          storeJury(projectId, { jobId: outcome.jobId, path });
          setState({ status: 'running', path, jobId: outcome.jobId });
        } else {
          setState({
            status: 'round_limit',
            path: outcome.path,
            maxRounds: outcome.maxRounds,
            best: outcome.best,
          });
        }
      } catch (error) {
        setState({ status: 'failed', path, code: designErrorCode(error) });
      } finally {
        inFlight.current = false;
      }
    },
    [enabled, projectId, setState],
  );

  const value = useMemo<JuryControls>(
    () =>
      enabled
        ? {
            enabled,
            state,
            busy: isJuryBusy(state),
            reviewPath,
            start: (path: string) => {
              start(path);
            },
          }
        : disabledJury,
    [enabled, reviewPath, start, state],
  );

  return <JuryContext.Provider value={value}>{children}</JuryContext.Provider>;
}

export function useJury(): JuryControls {
  return useContext(JuryContext);
}
