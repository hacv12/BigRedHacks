import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverageArea } from '../domain/types';
import type { RecentFeed } from '../domain/recent-types';
import { getRecentSource, loadRecentFeed } from './recent-reports';

/** Session-only cache: no individual reports are persisted to browser storage. */
export function useRecentActivity(area: CoverageArea | undefined) {
  const source = area ? getRecentSource(area.cityId) : undefined;
  // One session preference: switching cities must not undo the user's OFF choice.
  const [showActivity, setShowActivity] = useState(true);
  const enabled = !!area && showActivity;
  const [state, setState] = useState<{
    areaId: string;
    feed: RecentFeed | null;
    loading: boolean;
    error: string;
  }>({ areaId: '', feed: null, loading: false, error: '' });
  const cache = useRef(new Map<string, RecentFeed>());
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryTimer = useRef<number | null>(null);
  const deferredRetry = useRef(false);
  const lastAttempt = useRef({ areaId: '', at: 0 });
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const nextCheckAt = useRef(0);

  useEffect(() => {
    nextCheckAt.current = 0;
    setCooldownUntil(0);
  }, [area?.id]);

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      if (!area || !source || !enabled || controller.current) return;
      if (document.visibilityState !== 'visible') {
        deferredRetry.current = true;
        return;
      }
      const now = Date.now();
      const cached = cache.current.get(area.id);
      if (
        !force &&
        cached &&
        now - Date.parse(cached.checkedAt) < source.refreshIntervalMs
      ) {
        nextCheckAt.current =
          Date.parse(cached.checkedAt) + source.refreshIntervalMs;
        setState((previous) => ({
          areaId: area.id,
          feed: cached,
          loading: false,
          error: previous.areaId === area.id ? previous.error : '',
        }));
        return;
      }
      if (
        lastAttempt.current.areaId === area.id &&
        now - lastAttempt.current.at < 30_000
      ) {
        setState({
          areaId: area.id,
          feed: cached ?? null,
          loading: true,
          error: '',
        });
        if (retryTimer.current !== null)
          window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(
          () => {
            retryTimer.current = null;
            if (document.visibilityState === 'visible') void refresh(true);
            else deferredRetry.current = true;
          },
          30_001 - (now - lastAttempt.current.at),
        );
        return;
      }
      lastAttempt.current = { areaId: area.id, at: now };
      deferredRetry.current = false;
      nextCheckAt.current = now + source.refreshIntervalMs;
      setCooldownUntil(now + 30_000);
      const active = new AbortController();
      controller.current = active;
      const current = ++request.current;
      setState({
        areaId: area.id,
        feed: cached ?? null,
        loading: true,
        error: '',
      });
      try {
        const feed = await loadRecentFeed(area, active.signal);
        if (active.signal.aborted || request.current !== current) return;
        if (feed.areaId !== area.id || feed.sourceId !== source.id)
          throw new Error('The update did not match this coverage area.');
        cache.current.set(area.id, feed);
        nextCheckAt.current = Date.now() + source.refreshIntervalMs;
        setState({ areaId: area.id, feed, loading: false, error: '' });
      } catch (error) {
        if (active.signal.aborted || request.current !== current) return;
        // A transient outage should not wait hours for the next publication check.
        nextCheckAt.current = Date.now() + 60_000;
        setState({
          areaId: area.id,
          feed: cached ?? null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'The source could not be reached. Try again later.',
        });
      } finally {
        if (controller.current === active) controller.current = null;
      }
    },
    [area, source, enabled],
  );

  useEffect(() => {
    if (!enabled || !source) return;
    void refresh();
    const check = () => {
      if (document.visibilityState !== 'visible') {
        if (controller.current || retryTimer.current !== null) {
          deferredRetry.current = true;
          request.current += 1;
          controller.current?.abort();
          controller.current = null;
          if (retryTimer.current !== null)
            window.clearTimeout(retryTimer.current);
          retryTimer.current = null;
          setState((previous) => ({ ...previous, loading: false }));
        }
        return;
      }
      if (deferredRetry.current || Date.now() >= nextCheckAt.current)
        void refresh(true);
    };
    const timer = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      request.current += 1;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
      deferredRetry.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [enabled, source, refresh]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setTimeout(
      () => setCooldownUntil(0),
      Math.max(0, cooldownUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [cooldownUntil]);

  return {
    source,
    enabled,
    onToggle: () => setShowActivity((value) => !value),
    statusLabel: !source
      ? 'No recent feed'
      : source.kind === 'calls'
        ? 'Dispatch updates · delayed'
        : 'Published reports · delayed',
    checkIntervalLabel: source
      ? source.refreshIntervalMs < 3_600_000
        ? `Checks every ${source.refreshIntervalMs / 60_000} min while visible`
        : `Checks every ${source.refreshIntervalMs / 3_600_000} h while visible`
      : 'No automatic checks',
    feed: enabled && state.areaId === area?.id ? state.feed : null,
    loading: enabled && state.areaId === area?.id && state.loading,
    error: enabled && state.areaId === area?.id ? state.error : '',
    onRefresh: () => void refresh(true),
    refreshDisabled: state.loading || cooldownUntil > Date.now(),
  };
}
