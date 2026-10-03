import { RoutingError } from './routing';
import type { CityDataset, PlanRequest, RouteComparison } from './types';

export type PlannerMessage =
  | { type: 'init'; data: CityDataset }
  | { type: 'plan'; id: number; request: PlanRequest };
export type PlannerResponse =
  | { type: 'success'; id: number; result: RouteComparison }
  | { type: 'error'; id: number; code: string; message: string };

export function createRoutePlanner(data: CityDataset): {
  plan(request: PlanRequest): Promise<RouteComparison>;
  dispose(): void;
} {
  if (typeof Worker === 'undefined')
    throw new RoutingError(
      'WORKER_UNAVAILABLE',
      'Route planning requires Web Workers. Open this app in a current browser.',
    );
  const worker = new Worker(new URL('./planner-worker.ts', import.meta.url), {
    type: 'module',
  });
  type Pending = {
    id: number;
    request: PlanRequest;
    resolve: (result: RouteComparison) => void;
    reject: (error: unknown) => void;
  };
  let active: Pending | undefined;
  let queued: Pending | undefined;
  let nextId = 0;
  let stopped: Error | null = null;
  const cancelled = () =>
    new DOMException('Route planning was superseded.', 'AbortError');
  const stop = (error: Error) => {
    stopped = error;
    worker.terminate();
    active?.reject(error);
    queued?.reject(error);
    active = queued = undefined;
  };
  const dispatch = (entry: Pending) => {
    active = entry;
    try {
      worker.postMessage({
        type: 'plan',
        id: entry.id,
        request: entry.request,
      } satisfies PlannerMessage);
    } catch (error) {
      active = undefined;
      entry.reject(error);
    }
  };
  worker.onmessage = (event: MessageEvent<PlannerResponse>) => {
    const response = event.data;
    if (
      !response ||
      !active ||
      response.id !== active.id ||
      (response.type !== 'success' && response.type !== 'error') ||
      (response.type === 'success' && !response.result) ||
      (response.type === 'error' &&
        (typeof response.code !== 'string' ||
          typeof response.message !== 'string'))
    ) {
      stop(
        new RoutingError(
          'WORKER_FAILED',
          'The route planner returned an invalid response. Reload the coverage area.',
        ),
      );
      return;
    }
    const entry = active;
    active = undefined;
    if (response.type === 'success') entry.resolve(response.result);
    else entry.reject(new RoutingError(response.code, response.message));
    const next = queued;
    queued = undefined;
    if (next) dispatch(next);
  };
  worker.onerror = () =>
    stop(
      new RoutingError(
        'WORKER_FAILED',
        'The route planner could not run. Reload the coverage area and try again.',
      ),
    );
  worker.onmessageerror = () =>
    stop(
      new RoutingError(
        'WORKER_FAILED',
        'The route planner returned unreadable data. Reload the coverage area.',
      ),
    );
  try {
    worker.postMessage({ type: 'init', data } satisfies PlannerMessage);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    plan(request) {
      if (stopped) return Promise.reject(stopped);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const entry = { id, request, resolve, reject };
        if (active) {
          active.reject(cancelled());
          queued?.reject(cancelled());
          queued = entry;
        } else dispatch(entry);
      });
    },
    dispose() {
      stop(new DOMException('Route planning was cancelled.', 'AbortError'));
    },
  };
}
