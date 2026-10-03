import { afterEach, expect, it, vi } from 'vitest';
import type { PlannerMessage } from './planner-client';

afterEach(() => vi.unstubAllGlobals());
it('reports initialization failures and recovers from invalid plan requests', async () => {
  vi.resetModules();
  const scope = {
    onmessage: undefined as
      undefined | ((event: { data: PlannerMessage }) => void),
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', scope);
  await import('./planner-worker');
  const request = {
    origin: [0, 0],
    destination: [0.001, 0],
    bucket: 0,
    maxExtraMinutes: 0,
  } as const;
  scope.onmessage!({
    data: { type: 'init', data: null } as unknown as PlannerMessage,
  });
  scope.onmessage!({
    data: { type: 'plan', id: 1, request } as unknown as PlannerMessage,
  });
  expect(scope.postMessage.mock.lastCall?.[0]).toMatchObject({
    type: 'error',
    id: 1,
    code: 'INITIALIZATION_FAILED',
  });
  scope.onmessage!({
    data: {
      type: 'init',
      data: structuredClone({
        manifest: { planningBounds: [-1, -1, 1, 1] },
        nodes: [
          { id: 'a', point: [0, 0] },
          { id: 'b', point: [0.001, 0] },
        ],
        edges: [
          {
            id: 'ab',
            from: 'a',
            to: 'b',
            coordinates: [
              [0, 0],
              [0.001, 0],
            ],
            bidirectional: true,
            name: 'Street',
          },
        ],
        cells: [{ bounds: [-1, -1, 1, 1], intensity: [0.5, 0.5, 0.5, 0.5] }],
      }),
    } as unknown as PlannerMessage,
  });
  scope.onmessage!({
    data: {
      type: 'plan',
      id: 2,
      request: { ...request, bucket: 8 },
    } as unknown as PlannerMessage,
  });
  expect(scope.postMessage.mock.lastCall?.[0]).toMatchObject({
    type: 'error',
    id: 2,
    code: 'INVALID_REQUEST',
  });
  scope.onmessage!({
    data: { type: 'plan', id: 3, request } as unknown as PlannerMessage,
  });
  expect(scope.postMessage.mock.lastCall?.[0]).toMatchObject({
    type: 'success',
    id: 3,
  });
  expect(scope.postMessage.mock.lastCall?.[0].result.routes[0].edgeIds).toEqual(
    ['ab'],
  );
});
