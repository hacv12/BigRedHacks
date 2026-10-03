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
  const pending = new Map<
    number,
    {
      resolve: (result: RouteComparison) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextId = 0,
    stopped: Error | null = null;
  const stop = (error: Error) => {
    stopped = error;
    worker.terminate();
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<PlannerResponse>) => {
    const response = event.data,
      entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.type === 'success') entry.resolve(response.result);
    else entry.reject(new RoutingError(response.code, response.message));
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
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({
            type: 'plan',
            id,
            request,
          } satisfies PlannerMessage);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    dispose() {
      stop(new DOMException('Route planning was cancelled.', 'AbortError'));
    },
  };
}
