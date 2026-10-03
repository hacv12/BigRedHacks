import { useEffect, useMemo, useState } from 'react';
import type { EndpointSuggestion } from '../components/EndpointSearch';
import { buildPlaceIndex, searchPlaces } from '../domain/place-search';
import type { CityDataset, CoverageArea } from '../domain/types';
import { GEOCODER_MIN_QUERY_LENGTH, searchAddresses } from './geocoding';

/** Names plus approximate coordinates deduplicate only matching places, not entire streets. */
export function mergePlaceSuggestions(
  local: EndpointSuggestion[],
  remote: EndpointSuggestion[],
  query: string,
): EndpointSuggestion[] {
  const ordered = /\d/.test(query)
    ? [...remote, ...local]
    : [...local, ...remote];
  const seen = new Set<string>();
  return ordered
    .filter((place) => {
      const name = place.label
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('en')
        .trim()
        .replace(/\s+/g, ' ');
      const key = `${name}:${place.point.map((value) => value.toFixed(5)).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function usePlaceSearch(
  data: CityDataset | null | undefined,
  area: CoverageArea | null | undefined,
  query: string,
  active: boolean,
): { results: EndpointSuggestion[]; loading: boolean; error: string } {
  const index = useMemo(() => (data ? buildPlaceIndex(data) : []), [data]);
  const local = useMemo<EndpointSuggestion[]>(() => {
    const places = query.trim()
      ? searchPlaces(index, query, 6)
      : index.filter((place) => place.kind === 'landmark').slice(0, 8);
    return places.map((place) => ({
      id: place.id,
      label: place.name,
      point: place.point,
      kind: place.kind,
      source: 'local',
      detail:
        place.kind === 'street'
          ? 'Street section · bundled map'
          : 'Saved place · bundled map',
    }));
  }, [index, query]);
  const key = JSON.stringify([area?.id, area?.bounds, query.trim(), active]);
  const [remote, setRemote] = useState<{
    key: string;
    results: EndpointSuggestion[];
    loading: boolean;
    error: string;
  }>({ key: '', results: [], loading: false, error: '' });
  useEffect(() => {
    if (
      !active ||
      !area ||
      !data ||
      query.trim().length < GEOCODER_MIN_QUERY_LENGTH
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRemote({ key, results: [], loading: true, error: '' });
      void searchAddresses(query, area, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted)
            setRemote({
              key,
              loading: false,
              error: '',
              results: results.map((place) => ({
                id: place.id,
                label: place.name,
                detail: place.detail,
                point: place.point,
                kind: place.kind,
                source: 'geocoder',
              })),
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setRemote({
              key,
              results: [],
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Address search is unavailable. Use a saved place or the map.',
            });
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data, area, query, active, key]);
  const current = remote.key === key ? remote : undefined;
  return {
    results: mergePlaceSuggestions(local, current?.results ?? [], query),
    loading: current?.loading ?? false,
    error: current?.error ?? '',
  };
}
