import { describe, expect, it } from 'vitest';
import { mergePlaceSuggestions } from './use-place-search';
import type { EndpointSuggestion } from '../components/EndpointSearch';
const place = (
  id: string,
  label: string,
  source: 'local' | 'geocoder' = 'local',
): EndpointSuggestion => ({
  id,
  label,
  source,
  point: [-74, 40.75],
  kind: 'place',
});
describe('merged endpoint suggestions', () => {
  it('prioritizes provider addresses for numeric queries and local places otherwise', () => {
    const local = [place('l', 'Fifth Avenue')],
      remote = [place('r', '350 Fifth Avenue', 'geocoder')];
    expect(mergePlaceSuggestions(local, remote, '350 fifth')[0].id).toBe('r');
    expect(mergePlaceSuggestions(local, remote, 'fifth')[0].id).toBe('l');
  });
  it('deduplicates normalized label and point, retaining different locations', () => {
    const local = [place('l', 'Praça da Sé')];
    const remote = [
      place('r', 'Praca da Se', 'geocoder'),
      {
        ...place('other', 'Praça da Sé', 'geocoder'),
        point: [-73.99, 40.75] as [number, number],
      },
    ];
    expect(mergePlaceSuggestions(local, remote, 'Se').map((p) => p.id)).toEqual(
      ['l', 'other'],
    );
  });
  it('caps suggestions without mutating input', () => {
    const local = Array.from({ length: 10 }, (_, i) =>
      place(String(i), `Place ${i}`),
    );
    expect(mergePlaceSuggestions(local, [], '')).toHaveLength(8);
    expect(local).toHaveLength(10);
  });
});
