import { useId, useMemo, useState } from 'react';
import type { CityDataset } from '../domain/types';
import {
  buildPlaceIndex,
  searchPlaces,
  type LocalPlace,
} from '../domain/place-search';
import './map-picker.css';
export type { LocalPlace } from '../domain/place-search';
interface Props {
  data: CityDataset;
  target: 'origin' | 'destination';
  error: string;
  onCancel: () => void;
  onUseCenter: () => void;
  onLocate: (place: LocalPlace) => void;
  onFocusMap: () => void;
}
export default function MapPickerControls({
  data,
  target,
  error,
  onCancel,
  onUseCenter,
  onLocate,
  onFocusMap,
}: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const index = useMemo(() => buildPlaceIndex(data), [data]);
  const results = useMemo(() => searchPlaces(index, query), [index, query]);
  return (
    <section
      className="pick-banner guided-picker"
      aria-label={`Choose ${target} location`}
    >
      <strong>
        Choose your {target === 'origin' ? 'start' : 'destination'}
      </strong>
      <p>
        Move the map under the center marker, then choose Use map center. You
        can also select a point on the map.
      </p>
      <div className="guided-picker-actions">
        <button type="button" className="guided-confirm" onClick={onUseCenter}>
          Use map center
        </button>
        <button type="button" onClick={onCancel}>
          Cancel map selection
        </button>
      </div>
      <button type="button" className="guided-keyboard" onClick={onFocusMap}>
        Move map with keyboard
      </button>
      <p className="guided-keyboard-help">
        Arrow keys pan the focused map. Tab returns to controls to confirm.
      </p>
      {error && (
        <p role="alert" className="guided-picker-error">
          {error}
        </p>
      )}
      <details className="guided-finder">
        <summary>Find a street or landmark</summary>
        <label htmlFor={`${id}-search`}>Search this coverage area</label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Street or landmark name"
          autoComplete="off"
          maxLength={120}
        />
        <p>
          Local names only. Select a result to center the map, then confirm your
          point.
        </p>
        {query.trim() && (
          <p role="status">
            {results.length
              ? `${results.length} matching places`
              : 'No matching local names. Try another name or move the map.'}
          </p>
        )}
        <ul
          tabIndex={results.length ? 0 : undefined}
          aria-label="Local place search results"
        >
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={(event) => {
                  const disclosure = event.currentTarget.closest('details');
                  if (disclosure) disclosure.open = false;
                  onLocate(place);
                  event.currentTarget
                    .closest('.guided-picker')
                    ?.querySelector<HTMLButtonElement>('.guided-confirm')
                    ?.focus({ preventScroll: true });
                }}
              >
                <strong>{place.name}</strong>
                <span>
                  {place.kind === 'street'
                    ? 'Street reference point · not an address/entrance'
                    : 'Landmark map reference · check the access point'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
