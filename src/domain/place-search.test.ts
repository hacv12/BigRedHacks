import { describe, expect, it } from 'vitest';
import { buildPlaceIndex, searchPlaces } from './place-search';
import type { CityDataset } from './types';
const fixture = {
  nodes: [
    { id: 'a', point: [0, 0] },
    { id: 'b', point: [2, 0] },
    { id: 'c', point: [10, 0] },
    { id: 'd', point: [12, 0] },
  ],
  edges: [
    { id: '1', from: 'a', to: 'b', name: 'Rua São João' },
    { id: '2', from: 'c', to: 'd', name: 'Rua São João' },
    { id: '3', from: 'a', to: 'b', name: 'Steps' },
    { id: '4', from: 'a', to: 'b', name: 'Walking path' },
    { id: '5', from: 'a', to: 'b', name: 'Unnamed street' },
  ],
  landmarks: [{ id: 'se', name: 'Praça da Sé', point: [1, 1] }],
} as unknown as CityDataset;
describe('local place search', () => {
  it('matches case and accents without requests, and rejects empty queries', () => {
    const index = buildPlaceIndex(fixture);
    expect(searchPlaces(index, '  SAO  ')).toHaveLength(1);
    expect(searchPlaces(index, 'praca da se')[0].point).toEqual([1, 1]);
    expect(searchPlaces(index, '   ')).toEqual([]);
    expect(searchPlaces(index, 'unknown')).toEqual([]);
  });
  it('uses a real member node for disconnected same-name streets, with stable ties', () => {
    const result = buildPlaceIndex(fixture).find(
      (place) => place.kind === 'street',
    )!;
    expect(result.point).toEqual([2, 0]);
    expect(
      fixture.nodes.some(
        (node) => node.point.toString() === result.point.toString(),
      ),
    ).toBe(true);
    expect(
      buildPlaceIndex({
        ...fixture,
        edges: [...fixture.edges].reverse(),
        nodes: [...fixture.nodes].reverse(),
      }),
    ).toEqual(buildPlaceIndex(fixture));
  });
  it('deduplicates repeated edge nodes and excludes generic names', () => {
    expect(
      buildPlaceIndex({
        ...fixture,
        edges: [...fixture.edges, fixture.edges[0]],
      }),
    ).toHaveLength(2);
    expect(buildPlaceIndex(fixture).map((place) => place.name)).toEqual([
      'Praça da Sé',
      'Rua São João',
    ]);
  });
  it('bounds results at six, honors smaller limits and prefers exact matches', () => {
    const index = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Street ${i}`,
      kind: 'street' as const,
      point: [i, 0] as [number, number],
    }));
    expect(searchPlaces(index, 'street', 100)).toHaveLength(6);
    expect(searchPlaces(index, 'street', 2)).toHaveLength(2);
    expect(searchPlaces(index, 'street', NaN)).toEqual([]);
    expect(searchPlaces(index, 'street 9')[0].id).toBe('9');
  });
});
