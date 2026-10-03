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
  it('coalesces five inputs to first and last while settling every promise', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const planner = createRoutePlanner(data),
      worker = FakeWorker.latest;
    const promises = Array.from({ length: 5 }, (_, bucket) =>
      planner.plan({ ...request, maxExtraMinutes: bucket }),
    );
    const settled = Promise.allSettled(promises);
    expect(worker.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
      'init',
      'plan',
    ]);
    worker.onmessage!({ data: { type: 'success', id: 1, result } });
    expect(worker.postMessage.mock.calls.map(([m]) => m.id)).toEqual([
      undefined,
      1,
      5,
    ]);
    worker.onmessage!({ data: { type: 'success', id: 5, result } });
    const outcomes = await settled;
    for (const outcome of outcomes.slice(0, 4))
      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: { name: 'AbortError' },
      });
    expect(outcomes[4]).toEqual({ status: 'fulfilled', value: result });
    planner.dispose();
  });
  it.each(['dispose', 'onerror', 'onmessageerror', 'invalid'])(
    'settles active and queued on %s',
    async (action) => {
      vi.stubGlobal('Worker', FakeWorker);
      const planner = createRoutePlanner(data),
        worker = FakeWorker.latest;
      const settled = Promise.allSettled([
        planner.plan(request),
        planner.plan(request),
      ]);
      if (action === 'dispose') planner.dispose();
      else if (action === 'invalid')
        worker.onmessage!({ data: { type: 'success', id: 99, result } });
      else worker[action as 'onerror' | 'onmessageerror']!();
      expect((await settled).every((x) => x.status === 'rejected')).toBe(true);
      await expect(planner.plan(request)).rejects.toBeDefined();
      expect(worker.terminate).toHaveBeenCalled();
    },
  );
  it('recovers from dispatch exceptions including the queued dispatch', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const planner = createRoutePlanner(data),
      worker = FakeWorker.latest;
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    await expect(planner.plan(request)).rejects.toThrow('clone failed');
    const outcomes = Promise.allSettled([
      planner.plan(request),
      planner.plan(request),
    ]);
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('queued clone failed');
    });
    worker.onmessage!({ data: { type: 'success', id: 2, result } });
    expect(await outcomes).toMatchObject([
      { status: 'rejected', reason: { name: 'AbortError' } },
      { status: 'rejected', reason: { message: 'queued clone failed' } },
    ]);
    const next = planner.plan(request);
    worker.onmessage!({
      data: {
        type: 'error',
        id: 4,
        code: 'DISCONNECTED',
        message: 'Disconnected',
      },
    });
    await expect(next).rejects.toMatchObject({ code: 'DISCONNECTED' });
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
