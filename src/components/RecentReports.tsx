import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import type { CoverageArea } from '../domain/types';
import type {
  RecentBubble,
  RecentFeed,
  RecentSource,
} from '../domain/recent-types';
import './recent-reports.css';

export interface RecentReportsProps {
  area: CoverageArea;
  source: RecentSource | undefined;
  enabled: boolean;
  onToggle: () => void;
  loading: boolean;
  feed: RecentFeed | null;
  error: string;
  onRefresh: () => void;
  refreshDisabled: boolean;
  statusLabel?: string;
  checkIntervalLabel?: string;
  bubbles: RecentBubble[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  category: string;
  onCategoryChange: (value: string) => void;
}
// Source timestamps are civil time. Do not interpret them in the browser timezone.
const civil = (value: string) => value.replace('T', ' ').replace(/\.\d+$/, '');
const utc = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unavailable'
    : `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
};

export default function RecentReports({
  area,
  source,
  enabled,
  onToggle,
  loading,
  feed,
  error,
  onRefresh,
  refreshDisabled,
  statusLabel,
  checkIntervalLabel,
  bubbles,
  selectedId,
  onSelect,
  category,
  onCategoryChange,
}: RecentReportsProps) {
  const id = useId();
  const [pageState, setPageState] = useState({ key: '', page: 0 });
  const key = `${area.id}:${category}:${feed?.checkedAt ?? ''}`;
  const pages = Math.max(1, Math.ceil(bubbles.length / 10));
  const page = Math.min(pageState.key === key ? pageState.page : 0, pages - 1);
  const selected = bubbles.find((bubble) => bubble.id === selectedId);
  const categories = [
    ...new Set(feed?.records.map((record) => record.category) ?? []),
  ].sort();
  const displayedCount = bubbles.reduce((sum, bubble) => sum + bubble.count, 0);
  const noun = source?.kind === 'calls' ? 'calls' : 'reports';
  const validFeed =
    feed?.areaId === area.id && feed.sourceId === source?.id ? feed : null;

  return (
    <section className="recent-reports" aria-label="Latest published activity">
      <button
        className="recent-toggle"
        aria-expanded={enabled}
        aria-controls={enabled ? `${id}-panel` : undefined}
        onClick={onToggle}
      >
        <span>{enabled ? 'Hide latest activity' : 'Show latest activity'}</span>
        {enabled ? (
          <ChevronUp size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </button>
      {enabled && (
        <div id={`${id}-panel`} className="recent-panel">
          {!source ? (
            <p role="status">
              No verified recent feed is available for {area.city}. The bundled
              2025 historical package remains available for route comparisons.
            </p>
          ) : (
            <>
              <div className="recent-heading">
                <h3>
                  {statusLabel ??
                    (source.kind === 'calls'
                      ? 'Dispatch updates · delayed'
                      : 'Published reports · delayed')}
                </h3>
                <button
                  className="recent-refresh"
                  onClick={onRefresh}
                  disabled={loading || refreshDisabled}
                  aria-label="Refresh latest activity"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh
                </button>
              </div>
              <p>
                {source.cadence} · {source.delayNote}
              </p>
              {checkIntervalLabel && (
                <p className="recent-check-cadence">
                  {checkIntervalLabel}. New publications appear automatically;
                  this is not an instant event feed.
                </p>
              )}
              <p className="recent-model-note">
                Route scores still use 2025 historical reports. These bubbles do
                not change your route or predict safety.
                {source.kind === 'calls'
                  ? ' Dispatch calls are not confirmed crimes.'
                  : ''}
              </p>
              {loading && (
                <p role="status">
                  Checking published activity
                  {validFeed ? '; previous results remain visible' : ''}…
                </p>
              )}
              {error && (
                <p role="alert" className="recent-error">
                  {error}{' '}
                  {validFeed
                    ? 'Showing the last successful check below.'
                    : 'Recent activity is unavailable; this does not mean there were no reports.'}
                </p>
              )}
              {validFeed && (
                <>
                  <p className="recent-window">
                    <strong>
                      {source.kind === 'calls'
                        ? 'Call-received window'
                        : 'Occurrence window'}
                      : {validFeed.windowStart.slice(0, 10)} –{' '}
                      {validFeed.windowEnd.slice(0, 10)}
                    </strong>
                    <br />
                    {area.timezone}
                  </p>
                  <details className="recent-source-details">
                    <summary>Source scope and freshness</summary>
                    <p>{source.scopeNote}</p>
                    <dl className="recent-freshness">
                      <div>
                        <dt>Exact query window · source local time</dt>
                        <dd>
                          {civil(validFeed.windowStart)} –{' '}
                          {civil(validFeed.windowEnd)} · {area.timezone}
                        </dd>
                      </div>
                      <div>
                        <dt>Latest available source event</dt>
                        <dd>
                          {validFeed.latestAvailableAt
                            ? `${civil(validFeed.latestAvailableAt)} · ${area.timezone}`
                            : 'Unavailable'}
                        </dd>
                      </div>
                      <div>
                        <dt>Checked · fetch time</dt>
                        <dd>{utc(validFeed.checkedAt)}</dd>
                      </div>
                      <div>
                        <dt>Publisher updated</dt>
                        <dd>
                          {validFeed.publisherUpdatedAt
                            ? utc(validFeed.publisherUpdatedAt)
                            : 'Unavailable from this source'}
                        </dd>
                      </div>
                    </dl>
                    {validFeed.excludedRows > 0 && (
                      <p>
                        {validFeed.excludedRows.toLocaleString()} source rows
                        excluded during validation.
                      </p>
                    )}
                  </details>
                  {validFeed.limited && (
                    <p role="alert" className="recent-error">
                      The source response reached its limit. Counts and bubbles
                      are incomplete.
                    </p>
                  )}
                  <label className="recent-filter" htmlFor={`${id}-category`}>
                    Activity category
                    <select
                      id={`${id}-category`}
                      value={category}
                      onChange={(event) => onCategoryChange(event.target.value)}
                    >
                      <option value="all">All categories</option>
                      {categories.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="recent-count">
                    {validFeed.records.length.toLocaleString()} qualifying{' '}
                    {noun} in response · {displayedCount.toLocaleString()} shown
                    in {bubbles.length.toLocaleString()} approximate cells
                    {validFeed.limited ? ' (incomplete)' : ''}.
                  </p>
                  <p>
                    Bubbles show counts in approximate 250 m cells, not a danger
                    radius.
                  </p>
                  {!bubbles.length && !error && (
                    <p role="status">
                      No qualifying {noun} in this window
                      {category !== 'all' ? ' for this category' : ''}. This is
                      not evidence of no activity.
                    </p>
                  )}
                  {selected && (
                    <section
                      className="recent-selection"
                      aria-label="Selected activity cell"
                    >
                      <div className="recent-heading">
                        <h4>Selected approximate cell</h4>
                        <button
                          onClick={() => onSelect(null)}
                          aria-label="Clear selected activity cell"
                        >
                          Clear
                        </button>
                      </div>
                      <p>
                        <strong>
                          {selected.count.toLocaleString()} {noun}
                        </strong>{' '}
                        · approximately 250 m cell
                      </p>
                      <ul>
                        {selected.categories.map((item) => (
                          <li key={item.name}>
                            {item.name}: {item.count.toLocaleString()}
                          </li>
                        ))}
                      </ul>
                      <p>
                        {source.eventLabel}: {civil(selected.firstAt)} –{' '}
                        {civil(selected.lastAt)} · {area.timezone}
                      </p>
                      {selected.lastReportedAt && (
                        <p>
                          Latest reported date:{' '}
                          {selected.lastReportedAt.slice(0, 10)} ·{' '}
                          {area.timezone}
                        </p>
                      )}
                      {source.kind === 'calls' && (
                        <p>
                          Published status: {selected.openCalls} open ·{' '}
                          {selected.closedCalls} closed. Status may have
                          changed.
                        </p>
                      )}
                      <p>{source.locationNote}</p>
                      <p>
                        Approximate cell center: {selected.center[1].toFixed(3)}
                        , {selected.center[0].toFixed(3)}.
                      </p>
                    </section>
                  )}
                  {!!bubbles.length && (
                    <>
                      <ol
                        className="recent-cell-list"
                        tabIndex={0}
                        start={page * 10 + 1}
                        aria-label="Approximate activity cells"
                      >
                        {bubbles
                          .slice(page * 10, page * 10 + 10)
                          .map((bubble, index) => (
                            <li key={bubble.id}>
                              <button
                                aria-pressed={selectedId === bubble.id}
                                onClick={() => onSelect(bubble.id)}
                              >
                                <strong>
                                  Cell {page * 10 + index + 1} ·{' '}
                                  {bubble.count.toLocaleString()} {noun}
                                </strong>
                                <span>
                                  {bubble.categories
                                    .map((item) => item.name)
                                    .join(', ')}
                                </span>
                                <small>
                                  Cell center: {bubble.center[1].toFixed(3)},{' '}
                                  {bubble.center[0].toFixed(3)}
                                  <br />
                                  Latest: {civil(bubble.lastAt)} ·{' '}
                                  {area.timezone}
                                </small>
                              </button>
                            </li>
                          ))}
                      </ol>
                      {pages > 1 && (
                        <nav
                          className="recent-pagination"
                          aria-label="Activity cell pages"
                        >
                          <button
                            disabled={page === 0}
                            onClick={() =>
                              setPageState({ key, page: page - 1 })
                            }
                          >
                            Previous
                          </button>
                          <span>
                            Page {page + 1} of {pages}
                          </span>
                          <button
                            disabled={page === pages - 1}
                            onClick={() =>
                              setPageState({ key, page: page + 1 })
                            }
                          >
                            Next
                          </button>
                        </nav>
                      )}
                      <p>
                        {source.locationNote} Bubble size shows count, not
                        severity.
                      </p>
                    </>
                  )}
                </>
              )}
              <a
                className="recent-source"
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source: {source.name} ↗
              </a>
            </>
          )}
        </div>
      )}
    </section>
  );
}
