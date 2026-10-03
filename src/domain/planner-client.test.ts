import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutePlanner } from './planner-client';
import type { CityDataset, PlanRequest, RouteComparison } from './types';

class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
const data = { nodes: [], edges: [], cells: [] } as unknown as CityDataset;
const request: PlanRequest = {
  origin: [0, 0],
  destination: [1, 1],
  bucket: 0,
  maxExtraMinutes: 3,
};
const result = { routes: [] } as unknown as RouteComparison;
afterEach(() => vi.unstubAllGlobals());
describe('worker planner client', () => {
  it('initializes once and matches out-of-order responses to request IDs', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const planner = createRoutePlanner(data),
      worker = FakeWorker.latest;
    const first = planner.plan(request),
      second = planner.plan(request);
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.type),
    ).toEqual(['init', 'plan', 'plan']);
    expect(worker.postMessage.mock.calls[0][0].data).toBe(data);
    worker.onmessage!({ data: { type: 'success', id: 2, result } });
    worker.onmessage!({
      data: {
        type: 'error',
        id: 1,
        code: 'OUTSIDE_COVERAGE',
        message: 'Outside',
      },
    });
    await expect(second).resolves.toEqual(result);
    await expect(first).rejects.toMatchObject({ code: 'OUTSIDE_COVERAGE' });
    const third = planner.plan(request);
    worker.onmessage!({ data: { type: 'success', id: 3, result } });
    await expect(third).resolves.toEqual(result);
    planner.dispose();
  });
  it('terminates and rejects pending and future requests on disposal', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const planner = createRoutePlanner(data),
      pending = planner.plan(request);
    planner.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(planner.plan(request)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(FakeWorker.latest.terminate).toHaveBeenCalled();
  });
  it('rejects all requests after a worker startup failure', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const planner = createRoutePlanner(data),
      pending = planner.plan(request);
    FakeWorker.latest.onerror!();
    await expect(pending).rejects.toMatchObject({ code: 'WORKER_FAILED' });
    await expect(planner.plan(request)).rejects.toMatchObject({
      code: 'WORKER_FAILED',
    });
  });
  it('explains unsupported browsers without running synchronous planning', () => {
    vi.stubGlobal('Worker', undefined);
    expect(() => createRoutePlanner(data)).toThrow('requires Web Workers');
  });
});
