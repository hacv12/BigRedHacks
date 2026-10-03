import { useRef, useState } from 'react';
import { LocateFixed, MapPin, X } from 'lucide-react';
import type { LngLat } from '../domain/types';
import './endpoint-search.css';

export interface EndpointSuggestion {
  id: string;
  label: string;
  detail?: string;
  point: LngLat;
  kind: 'landmark' | 'street' | 'address' | 'place';
  source: 'local' | 'geocoder';
}
export interface EndpointSearchProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (result: EndpointSuggestion) => void;
  results: EndpointSuggestion[];
  loading: boolean;
  error: string;
  selectedLabel?: string;
  selected?: boolean;
  onSearchActiveChange?: (active: boolean) => void;
  onMapSelect: () => void;
  onLocateCurrent?: () => void;
  locating?: boolean;
  placeholder?: string;
  providerDisclosure?: string;
  providerLink?: { label: string; url: string };
}

/** Controlled search: parent owns network requests and commits coordinates only onSelect. */
export default function EndpointSearch({
  id,
  label,
  value,
  onValueChange,
  onSelect,
  results,
  loading,
  error,
  selectedLabel,
  selected = false,
  onSearchActiveChange,
  onMapSelect,
  onLocateCurrent,
  locating = false,
  placeholder = 'Address, street or place',
  providerDisclosure,
  providerLink,
}: EndpointSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const [open, updateOpen] = useState(false);
  const setOpen = (value: boolean) => {
    updateOpen(value);
    onSearchActiveChange?.(value);
  };
  const [active, setActive] = useState<{ query: string; id: string } | null>(
    null,
  );
  const suggestions = results.slice(0, 6);
  const activeIndex =
    active?.query === value
      ? suggestions.findIndex((item) => item.id === active.id)
      : -1;
  const expanded = open;
  const optionId = (index: number) => `${id}-option-${index}`;
  const choose = (suggestion: EndpointSuggestion) => {
    setOpen(false);
    setActive(null);
    onSelect(suggestion);
    input.current?.focus({ preventScroll: true });
  };
  return (
    <div
      className="endpoint-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setActive(null);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="endpoint-search-field">
        <input
          data-confirmed={selected}
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-suggestions` : undefined}
          aria-activedescendant={
            expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          onFocus={() => {
            onSearchActiveChange?.(true);
            if (!selected) updateOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setActive(null);
            setOpen(true);
            onValueChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              if (suggestions.length) {
                const next =
                  event.key === 'ArrowDown'
                    ? (activeIndex + 1) % suggestions.length
                    : activeIndex <= 0
                      ? suggestions.length - 1
                      : activeIndex - 1;
                setActive({ query: value, id: suggestions[next].id });
                requestAnimationFrame(() =>
                  document
                    .getElementById(optionId(next))
                    ?.scrollIntoView({ block: 'nearest' }),
                );
              }
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault();
              if (activeIndex >= 0) choose(suggestions[activeIndex]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(null);
            } else if (event.key === 'Tab') {
              setOpen(false);
              setActive(null);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="endpoint-clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onValueChange('');
              setActive(null);
              input.current?.focus();
              setOpen(true);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
        <div className="endpoint-search-actions">
          <button
            type="button"
            aria-label={`Choose ${id} on map`}
            title={`Choose ${id} on map`}
            onClick={() => {
              setOpen(false);
              onMapSelect();
            }}
          >
            <MapPin size={15} aria-hidden="true" />
          </button>
          {onLocateCurrent && (
            <button
              type="button"
              disabled={locating}
              aria-label={
                locating
                  ? 'Finding your location…'
                  : `Use my location for ${label.toLowerCase()}`
              }
              title="Use my location"
              onClick={() => {
                setOpen(false);
                onLocateCurrent();
              }}
            >
              <LocateFixed size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p id={`${id}-help`} className="endpoint-search-help">
        {selected
          ? `Selected: ${selectedLabel ?? value}`
          : 'Choose a suggestion or a point on the map.'}
      </p>
      {expanded && (
        <div className="endpoint-suggestions">
          <ul
            id={`${id}-suggestions`}
            role="listbox"
            aria-busy={loading}
            aria-label={`${label} suggestions`}
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
              >
                <strong>{suggestion.label}</strong>
                {suggestion.detail && <span>{suggestion.detail}</span>}
                <small>
                  {suggestion.source === 'local'
                    ? 'In this coverage area'
                    : 'Address search'}
                  {suggestion.kind === 'street'
                    ? ' · street reference, not an entrance'
                    : ''}
                </small>
              </li>
            ))}
          </ul>
          <p className="endpoint-search-status" role="status">
            {loading
              ? 'Searching addresses…'
              : suggestions.length
                ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}. Use arrow keys and Enter to select.`
                : 'No matches. Try a nearby street or choose on the map.'}
          </p>
          {providerDisclosure && (
            <p className="endpoint-provider">
              {providerDisclosure}
              {providerLink && (
                <>
                  {' '}
                  <a href={providerLink.url} target="_blank" rel="noreferrer">
                    {providerLink.label}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="endpoint-search-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
