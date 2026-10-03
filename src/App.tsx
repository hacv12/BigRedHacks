import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Compass,
  Footprints,
  Info,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  X,
} from 'lucide-react';
import { createRoutePlanner } from './domain/planner-client';
import { loadCatalog, loadDataset } from './data/loaders';
import type {
  BucketIndex,
  CityDataset,
  CityCatalog,
  LngLat,
  RouteComparison,
} from './domain/types';

const latlng = (p: LngLat): L.LatLngTuple => [p[1], p[0]];
const distance = (m: number) => `${(m / 1000).toFixed(1)} km`;

export default function App() {
  const [data, setData] = useState<CityDataset | null>(null);
  const [catalog, setCatalog] = useState<CityCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [areaId, setAreaId] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const planGeneration = useRef(0);
  const planner = useRef<ReturnType<typeof createRoutePlanner> | null>(null);
  const area = catalog?.areas.find((item) => item.id === areaId);
  const windows = data?.manifest.timeBuckets ?? [];
  const period = data
    ? [
        ...new Set([
          data.manifest.periodStart.slice(0, 4),
          data.manifest.periodEnd.slice(0, 4),
        ]),
      ].join('–')
    : '';
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [custom, setCustom] = useState<{
    origin?: LngLat;
    destination?: LngLat;
  }>({});
  const [bucket, setBucket] = useState<BucketIndex>(2);
  const [budget, setBudget] = useState(8);
  const [result, setResult] = useState<RouteComparison | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [details, setDetails] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tileError, setTileError] = useState(false);
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  const [fit, setFit] = useState(0);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const comparisonRef = useRef<RouteComparison | null>(null);
  comparisonRef.current = result;
  function fitComparison(m: L.Map, comparison: RouteComparison | null) {
    if (!comparison?.routes.length) return;
    const compact = window.matchMedia('(max-width: 900px)').matches;
    m.fitBounds(
      L.latLngBounds(
        comparison.routes.flatMap((r) => r.coordinates.map(latlng)),
      ),
      {
        paddingTopLeft: compact ? [30, 105] : [65, 95],
        paddingBottomRight: compact ? [55, 120] : [65, 95],
        maxZoom: 16,
        animate: false,
      },
    );
  }
  const pickRef = useRef(picking);
  pickRef.current = picking;
  const [plannedPoints, setPlannedPoints] = useState<{
    origin: LngLat;
    destination: LngLat;
  } | null>(null);

  function invalidatePlan() {
    planGeneration.current += 1;
    setBusy(false);
    setDirty(true);
    setError('');
  }

  async function compute(
    _dataset: CityDataset,
    start: LngLat,
    end: LngLat,
    time = bucket,
    extra = budget,
  ) {
    const currentPlanner = planner.current;
    if (!currentPlanner) return;
    const request = ++planGeneration.current;
    const cityGeneration = generation.current;
    setBusy(true);
    setDirty(false);
    setResult(null);
    setSelected('');
    setError('');
    try {
      const comparison = await currentPlanner.plan({
        origin: start,
        destination: end,
        bucket: time,
        maxExtraMinutes: extra,
      });
      if (
        request !== planGeneration.current ||
        cityGeneration !== generation.current
      )
        return;
      setResult(comparison);
      setSelected(comparison.routes.at(-1)?.id ?? '');
      setDirty(false);
      setPlannedPoints({ origin: start, destination: end });
      setFit((v) => v + 1);
    } catch (e) {
      if (
        request !== planGeneration.current ||
        cityGeneration !== generation.current
      )
        return;
      setResult(null);
      setSelected('');
      setError(
        e instanceof Error
          ? e.message
          : 'Could not calculate this walk. Try again or choose another endpoint.',
      );
    } finally {
      if (
        request === planGeneration.current &&
        cityGeneration === generation.current
      )
        setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCatalogError('');
    loadCatalog(controller.signal)
      .then((next) => {
        if (!active) return;
        const requested = new URL(window.location.href).searchParams.get(
          'area',
        );
        const chosen =
          next.areas.find((item) => item.id === requested)?.id ??
          next.defaultAreaId;
        if (requested && requested !== chosen)
          setNotice(
            'That coverage area is unavailable. Showing the default supported area.',
          );
        setCatalog(next);
        setAreaId(chosen);
      })
      .catch((e) => {
        if (active && !controller.signal.aborted)
          setCatalogError(
            e instanceof Error ? e.message : 'Could not load supported cities.',
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [catalogReload]);

  function resetCity() {
    generation.current += 1;
    planGeneration.current += 1;
    planner.current?.dispose();
    planner.current = null;
    setData(null);
    setResult(null);
    setOrigin('');
    setDestination('');
    setCustom({});
    setError('');
    setLoadError('');
    setPlannedPoints(null);
    setPicking(null);
    setDetails(false);
    setTileError(false);
    setSelected('');
    setDirty(false);
    setBusy(false);
    setOverlay(false);
    setBucket(2);
    setBudget(8);
  }

  useEffect(() => {
    if (!area) return;
    resetCity();
    const current = generation.current;
    const controller = new AbortController();
    const url = new URL(window.location.href);
    url.searchParams.set('area', area.id);
    window.history.replaceState(null, '', url);
    loadDataset(area, controller.signal)
      .then((dataset) => {
        if (controller.signal.aborted || current !== generation.current) return;
        const nextPlanner = createRoutePlanner(dataset);
        planner.current = nextPlanner;
        setData(dataset);
        const start = dataset.landmarks.find(
          (item) => item.id === area.defaultOriginId,
        )!;
        const end = dataset.landmarks.find(
          (item) => item.id === area.defaultDestinationId,
        )!;
        setOrigin(start.id);
        setDestination(end.id);
        void compute(dataset, start.point, end.point, 2, 8);
      })
      .catch((e) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setData(null);
        setLoadError(
          e instanceof Error
            ? e.message
            : 'Could not load this coverage area. Try again.',
        );
      });
    return () => {
      controller.abort();
      generation.current += 1;
      planGeneration.current += 1;
      planner.current?.dispose();
      planner.current = null;
    };
  }, [area, reload]);

  useEffect(() => {
    if (!data || !mapEl.current || map.current) return;
    const b = data.manifest.planningBounds;
    const mapGeneration = generation.current;
    const m = L.map(mapEl.current, {
      zoomControl: false,
      preferCanvas: true,
      minZoom: 10,
      maxZoom: 19,
    });
    map.current = m;
    m.fitBounds([
      [b[1], b[0]],
      [b[3], b[2]],
    ]);
    L.tileLayer(
      import.meta.env.VITE_TILE_URL ||
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    )
      .on('tileerror', () => {
        if (mapGeneration === generation.current) setTileError(true);
      })
      .addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    const streets = L.layerGroup().addTo(m);
    L.polyline(
      data.edges.map((e) => e.coordinates.map(latlng)),
      { color: '#8caaa9', weight: 1.1, opacity: 0.42, interactive: false },
    ).addTo(streets);
    m.on('click', (e) => {
      if (mapGeneration !== generation.current) return;
      const target = pickRef.current;
      if (!target) return;
      const point: LngLat = [e.latlng.lng, e.latlng.lat];
      if (
        point[0] < b[0] ||
        point[0] > b[2] ||
        point[1] < b[1] ||
        point[1] > b[3]
      ) {
        setError(
          `Choose a point inside ${data.manifest.district}, ${data.manifest.city} coverage.`,
        );
        return;
      }
      setCustom((v) => ({ ...v, [target]: point }));
      (target === 'origin' ? setOrigin : setDestination)('custom');
      setPicking(null);
      invalidatePlan();
      setError('');
    });
    let previousWidth = 0,
      previousHeight = 0;
    const resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      m.invalidateSize({ animate: false });
      fitComparison(m, comparisonRef.current);
    });
    resize.observe(mapEl.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [data]);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    const group = L.layerGroup().addTo(m);
    if (overlay)
      data.cells.forEach((c) =>
        L.rectangle(
          [
            [c.bounds[1], c.bounds[0]],
            [c.bounds[3], c.bounds[2]],
          ],
          {
            stroke: false,
            fillColor: '#dd8b30',
            fillOpacity: c.intensity[bucket] * 0.58,
            interactive: false,
          },
        ).addTo(group),
      );
    const b = data.manifest.planningBounds;
    L.rectangle(
      [
        [b[1], b[0]],
        [b[3], b[2]],
      ],
      {
        color: '#547c80',
        weight: 1,
        dashArray: '4 6',
        fill: false,
        interactive: false,
      },
    ).addTo(group);
    if (result && !dirty) {
      const sorted = [...result.routes].sort(
        (a, b) => Number(a.id === selected) - Number(b.id === selected),
      );
      sorted.forEach((r) => {
        const active = r.id === selected;
        L.polyline(r.coordinates.map(latlng), {
          color: 'white',
          weight: active ? 9 : 6,
          opacity: 0.95,
          interactive: false,
        }).addTo(group);
        L.polyline(r.coordinates.map(latlng), {
          color: active ? '#098b80' : '#627380',
          weight: active ? 5 : 3,
          opacity: active ? 1 : 0.75,
          dashArray: active ? undefined : '7 7',
        })
          .on('click', () => setSelected(r.id))
          .addTo(group);
      });
      (
        [
          ['A', result.snappedOrigin],
          ['B', result.snappedDestination],
        ] as [string, LngLat][]
      ).forEach(([label, p]) =>
        L.marker(latlng(p), {
          icon: L.divIcon({
            className: 'endpoint-marker',
            html: `<span>${label}</span>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
        })
          .bindTooltip(
            `${label === 'A' ? 'Start' : 'Destination'} · snapped to walking graph`,
          )
          .addTo(group),
      );
      if (plannedPoints)
        (
          [
            ['origin', result.snappedOrigin],
            ['destination', result.snappedDestination],
          ] as const
        ).forEach(([key, snap]) => {
          if (
            L.latLng(latlng(plannedPoints[key])).distanceTo(latlng(snap)) > 5
          ) {
            L.circleMarker(latlng(plannedPoints[key]), {
              radius: 4,
              color: '#102c37',
              fillColor: 'white',
              fillOpacity: 1,
              weight: 1,
            })
              .bindTooltip('Requested point')
              .addTo(group);
            L.polyline([latlng(plannedPoints[key]), latlng(snap)], {
              color: '#102c37',
              weight: 1,
              dashArray: '3 4',
              interactive: false,
            }).addTo(group);
          }
        });
    }
    return () => {
      group.remove();
    };
  }, [data, result, selected, overlay, bucket, plannedPoints, dirty]);

  useEffect(() => {
    if (map.current) fitComparison(map.current, result);
  }, [fit, result]);
  useEffect(() => {
    if (details) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [details]);
  useEffect(() => {
    if (picking)
      mapEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [picking]);
  const route = !dirty
    ? result?.routes.find((r) => r.id === selected)
    : undefined;
  const resolve = (key: 'origin' | 'destination') =>
    (key === 'origin' ? origin : destination) === 'custom'
      ? custom[key]
      : data?.landmarks.find(
          (l) => l.id === (key === 'origin' ? origin : destination),
        )?.point;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="Brisa home">
          <span className="brand-symbol">
            <Navigation size={23} fill="currentColor" />
          </span>
          brisa<span className="brand-dot">.</span>
        </a>
        <span className="header-divider" />
        <span className="header-context">
          A little perspective for your next walk.
        </span>
        <div className="header-right">
          <span className="city-badge">
            <span />
            {area ? `${area.city} · ${area.region}` : 'Choose your coverage'}
          </span>
          <button
            className="text-button"
            disabled={!data}
            onClick={() => setDetails(true)}
          >
            <Info size={17} /> Behind the routes
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="planner">
          <div className="planner-heading">
            <span className="eyebrow">TAKE A DIFFERENT PERSPECTIVE</span>
            <h1>
              Your walk.
              <br /> Your tradeoff.
            </h1>
            <p>
              Compare walking routes with context from historical reported
              incidents.
            </p>
          </div>
          {catalog && (
            <div className="coverage-picker">
              <label className="field-label" htmlFor="coverage-area">
                City and coverage
              </label>
              <div className="select-wrap time-select">
                <select
                  id="coverage-area"
                  value={areaId}
                  onChange={(event) => {
                    resetCity();
                    setNotice('');
                    setAreaId(event.target.value);
                  }}
                >
                  {catalog.areas.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.city} · {item.region}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
              <p className="coverage-description">{area?.description}</p>
              {data && (
                <p className="coverage-source">
                  Source: {data.manifest.sourceName}
                </p>
              )}
              {notice && (
                <p role="status" className="source-note">
                  {notice}
                </p>
              )}
            </div>
          )}
          {catalogError ? (
            <div className="error" role="alert">
              {catalogError}
              <button onClick={() => setCatalogReload((value) => value + 1)}>
                Retry city list
              </button>
            </div>
          ) : loadError ? (
            <div className="error" role="alert">
              {loadError}
              <button onClick={() => setReload((v) => v + 1)}>Try again</button>
            </div>
          ) : !data ? (
            <div className="loading" role="status">
              {area
                ? `Loading ${area.city} · ${area.region} streets…`
                : 'Loading supported cities…'}
            </div>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const a = resolve('origin'),
                    b = resolve('destination');
                  if (a && b) compute(data, a, b);
                }}
              >
                <div className="endpoint-fields">
                  {(['origin', 'destination'] as const).map((key, i) => (
                    <div className="endpoint-field" key={key}>
                      <span className={`endpoint-dot ${i ? 'end' : ''}`}>
                        {i ? 'B' : 'A'}
                      </span>
                      <div className="field-inner">
                        <label htmlFor={key}>{i ? 'TO' : 'FROM'}</label>
                        <div className="select-wrap">
                          <select
                            id={key}
                            value={key === 'origin' ? origin : destination}
                            onChange={(e) => {
                              (key === 'origin' ? setOrigin : setDestination)(
                                e.target.value,
                              );
                              invalidatePlan();
                            }}
                          >
                            {custom[key] && (
                              <option value="custom">
                                Point selected on map
                              </option>
                            )}
                            {data.landmarks.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={14} />
                        </div>
                      </div>
                      <button
                        className={`icon-button pick-button ${picking === key ? 'active' : ''}`}
                        type="button"
                        aria-label={`Choose ${key} on map`}
                        title={`Choose ${key} on map`}
                        onClick={() => setPicking(picking === key ? null : key)}
                      >
                        <MapPin size={17} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="swap-button"
                    type="button"
                    aria-label="Swap start and destination"
                    onClick={() => {
                      setOrigin(destination);
                      setDestination(origin);
                      setCustom({
                        origin: custom.destination,
                        destination: custom.origin,
                      });
                      invalidatePlan();
                    }}
                  >
                    <ArrowDownUp size={14} />
                  </button>
                </div>
                <label className="field-label" htmlFor="time-window">
                  Historical time window <span>{data.manifest.timezone}</span>
                </label>
                <div className="select-wrap time-select">
                  <select
                    id="time-window"
                    value={bucket}
                    onChange={(e) => {
                      setBucket(Number(e.target.value) as BucketIndex);
                      invalidatePlan();
                    }}
                  >
                    {windows.map((w, i) => (
                      <option value={i} key={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
                <div className="slider-title">
                  <label htmlFor="detour">Room for a detour</label>
                  <output htmlFor="detour">+{budget} min</output>
                </div>
                <input
                  id="detour"
                  type="range"
                  min="0"
                  max="15"
                  value={budget}
                  style={
                    {
                      '--range-progress': `${(budget / 15) * 100}%`,
                    } as React.CSSProperties
                  }
                  onChange={(e) => {
                    setBudget(Number(e.target.value));
                    invalidatePlan();
                  }}
                />
                <div className="range-labels">
                  <span>Direct as possible</span>
                  <span>Up to 15 min extra</span>
                </div>
                <button
                  className="compare-button"
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? 'Comparing walking routes…'
                    : 'Compare walking routes'}{' '}
                  <ArrowRight size={18} />
                </button>
              </form>
              {error && (
                <div className="error" role="alert">
                  {error}
                  <button
                    onClick={() => {
                      resetCity();
                      setReload((value) => value + 1);
                    }}
                  >
                    Reload coverage area
                  </button>
                </div>
              )}
              <section
                className="results"
                aria-label="Route comparison"
                aria-live="polite"
              >
                <div className="results-title">
                  <h2>Your options</h2>
                  <span>
                    {busy
                      ? 'Calculating routes…'
                      : dirty
                        ? 'Update to compare'
                        : `${result?.routes.length ?? 0} routes compared`}
                  </span>
                </div>
                {!dirty &&
                  result?.routes.map((r, i) => (
                    <button
                      className={`route-card ${selected === r.id ? 'selected' : ''}`}
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      aria-pressed={selected === r.id}
                    >
                      <div className="route-card-top">
                        <span className="route-choice">
                          {selected === r.id ? <Check size={13} /> : null}
                        </span>
                        <strong>
                          {i === 0
                            ? 'Fastest walk'
                            : i === result.routes.length - 1
                              ? 'Lower exposure'
                              : 'Balanced walk'}
                        </strong>
                        {i > 0 && (
                          <span className="extra-time">
                            +{r.extraMinutes.toFixed(1)} min
                          </span>
                        )}
                      </div>
                      <div className="route-metrics">
                        <span className="route-time">
                          {Math.ceil(r.minutes)}
                          <small>min</small>
                        </span>
                        <span className="route-distance">
                          <Footprints size={15} />
                          {distance(r.meters)}
                        </span>
                        <span
                          className={`exposure-stat ${i === 0 ? 'baseline' : ''}`}
                        >
                          {i === 0
                            ? 'Baseline index'
                            : r.reductionPercent === null
                              ? 'Index unavailable'
                              : `${Math.round(r.reductionPercent)}% lower`}
                          <small>
                            {i === 0 ? 'Fastest route' : 'modeled exposure'}
                          </small>
                        </span>
                      </div>
                    </button>
                  ))}
                {!dirty && result?.message && (
                  <p className="result-message">{result.message}</p>
                )}
                {dirty && (
                  <p className="result-message">
                    Your trip has changed. Compare routes to see updated paths
                    and estimates.
                  </p>
                )}
                <p className="index-note">
                  <Info size={14} />
                  <span>
                    Exposure is a historical report index, not a prediction of
                    personal risk. Indices compare routes within the selected
                    snapshot, not across cities.
                  </span>
                </p>
              </section>
            </>
          )}
          <div className="planner-footer">
            <span className="snapshot-dot" />
            {data ? `${period} snapshot` : 'Historical report snapshots'}
            <button disabled={!data} onClick={() => setDetails(true)}>
              Data & method <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
        <section
          className={`map-panel ${picking ? 'picking' : ''}`}
          aria-label="Interactive walking route map"
        >
          <div ref={mapEl} className="map-canvas" />
          <div className="map-location">
            <Compass size={20} />
            <div>
              <strong>
                {area ? `${area.region}, ${area.city}` : 'Supported coverage'}
              </strong>
              <span>
                {data
                  ? `${windows[bucket]} · ${period} reports`
                  : 'Choose a supported area to plan a walk'}
              </span>
            </div>
            <span className="map-location-tag">{area?.regionCode}</span>
          </div>
          {data && (
            <div className="map-tools">
              <button
                className={overlay ? 'active' : ''}
                onClick={() => setOverlay((v) => !v)}
                aria-pressed={overlay}
                aria-label="Toggle reported incident intensity"
              >
                <Layers size={19} />
              </button>
              <button
                onClick={() => setFit((v) => v + 1)}
                aria-label="Fit routes to map"
              >
                <LocateFixed size={19} />
              </button>
            </div>
          )}
          {picking && (
            <div className="pick-banner" role="status">
              Click the map to choose your {picking}.
              <button
                aria-label="Cancel map selection"
                onClick={() => setPicking(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {data && (
            <div className="map-bottom">
              <div className="map-legend">
                <div className="legend-title">
                  <span className="legend-route" />
                  Selected walk
                  <span className="legend-route dashed" />
                  Alternative
                </div>
                <button
                  className="intensity-toggle"
                  onClick={() => setOverlay((v) => !v)}
                  aria-pressed={overlay}
                >
                  <span>Reported incident intensity</span>
                  <span className={`toggle ${overlay ? 'on' : ''}`} />
                </button>
                {overlay && (
                  <>
                    <div className="intensity-scale">
                      <span>Lower</span>
                      <i />
                      <span>Higher</span>
                    </div>
                    <p className="legend-caveat">
                      No reports does not mean no risk.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
          {tileError && (
            <div className="tile-status" role="status">
              Base tiles unavailable · bundled streets shown
            </div>
          )}
          {route && (
            <div className="route-map-label">
              <Footprints size={16} />
              <strong>{Math.ceil(route.minutes)} min</strong>
              <span>· {distance(route.meters)}</span>
            </div>
          )}
        </section>
      </main>
      <dialog
        ref={dialogRef}
        className="details-dialog"
        aria-labelledby="details-title"
        onCancel={() => setDetails(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              setDetails(false);
          }
        }}
      >
        <button
          autoFocus
          className="close-dialog icon-button"
          aria-label="Close data and method"
          onClick={() => setDetails(false)}
        >
          <X />
        </button>
        <span className="eyebrow">CONTEXT, NOT CERTAINTY</span>
        <h2 id="details-title">Behind your walk</h2>
        <p>
          Brisa compares actual walking paths using a historical
          reported-incident index. A lower index does not mean a route is safer,
          and no reports does not mean no risk.
        </p>
        {data && (
          <>
            <h3>The source data</h3>
            <p>
              <a
                href={data.manifest.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {data.manifest.sourceName} ↗
              </a>
              <br />
              {data.manifest.periodStart} through {data.manifest.periodEnd}; all
              windows use {data.manifest.timezone}.{' '}
              {data.manifest.eligibleReportCount.toLocaleString()} eligible
              reports from {data.manifest.sourceReportCount.toLocaleString()}{' '}
              source reports.
            </p>
            <p>
              <a
                href={data.manifest.osmSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap walking graph ↗
              </a>
              <br />
              Graph snapshot: {data.manifest.osmTimestamp}. Data downloaded:{' '}
              {data.manifest.downloadedAt}.
            </p>
            <h3>How the comparison works</h3>
            <p>
              Reports are aggregated into {data.manifest.cellSizeMeters} m
              cells. Six-hour counts are shrunk toward the all-day average,
              spatially smoothed, and normalized with a fixed dataset-wide
              scale. Eligible offense categories:{' '}
              {Object.keys(data.manifest.categoryWeights).join(', ')}. Category
              weights are defined by this snapshot.
            </p>
            <p>
              Each street’s exposure adds walking minutes × local intensity,
              sampled along its geometry. Walking speed is 1.35 m/s. We compare
              weighted shortest paths, enforce your extra-time limit, and keep
              distinct, nondominated choices. These candidates are not a
              guaranteed global optimum.
            </p>
            <h3>What this cannot tell you</h3>
            <p>
              Reporting practices, enforcement patterns, missing locations, and
              aggregation affect this index. It does not measure individual
              danger or account for current conditions, pedestrian volume,
              lighting, or accessibility. Street access tags are not a sidewalk
              or crossing audit.
            </p>
            {data.manifest.notes.map((n, i) => (
              <p key={i} className="source-note">
                {n}
              </p>
            ))}
            {result && (
              <p>
                Street snaps: start {Math.round(result.originSnapMeters)} m;
                destination {Math.round(result.destinationSnapMeters)} m. Small
                outlined dots show requested locations; A and B show routed
                street endpoints.
              </p>
            )}
            {route && (
              <>
                <h3>Your selected walk</h3>
                {result && (
                  <>
                    <a
                      className="google-link"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${result.snappedDestination[1]},${result.snappedDestination[0]}&travelmode=walking`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open destination in Google Maps ↗
                    </a>
                    <p className="source-note">
                      Google computes its own route. The route and modeled
                      exposure shown here do not transfer.
                    </p>
                  </>
                )}
                <p>
                  Modeled exposure: {route.exposure.toFixed(2)} index-minutes.
                  Largest segment contributions:
                </p>
                <ol className="segment-list">
                  {[...route.segments]
                    .sort((a, b) => b.exposure - a.exposure)
                    .slice(0, 5)
                    .map((s, i) => (
                      <li key={i}>
                        <span>
                          {s.name || 'Unnamed walking path'}
                          <small>
                            {distance(s.meters)} · {s.minutes.toFixed(1)} min
                          </small>
                        </span>
                        <strong>{s.exposure.toFixed(2)}</strong>
                      </li>
                    ))}
                </ol>
                <details>
                  <summary>Full street sequence</summary>
                  <ol>
                    {route.segments.map((s, i) => (
                      <li key={i}>
                        {s.name || 'Unnamed walking path'} ·{' '}
                        {Math.round(s.meters)} m
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            )}
            <p className="source-note">
              Model version: {data.manifest.modelVersion}.{' '}
              {data.manifest.coverageDescription}
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
