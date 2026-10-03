import { useEffect, useMemo, useRef, useState } from 'react';
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
  Navigation,
  Scan,
  X,
} from 'lucide-react';
import { createRoutePlanner } from './domain/planner-client';
import { loadCatalog, loadDataset } from './data/loaders';
import WalkDetails from './components/WalkDetails';
import AppInstall from './components/AppInstall';
import { cacheLoadedDataset } from './pwa/register';
import RecentReports from './components/RecentReports';
import RouteDecision from './components/RouteDecision';
import EndpointSearch, {
  type EndpointSuggestion,
} from './components/EndpointSearch';
import { usePlaceSearch } from './data/use-place-search';
import { GEOCODER_ATTRIBUTION } from './data/geocoding';
import {
  canLocate,
  requestCurrentPosition,
  tripEncodingBase,
  isNativePlatform,
} from './platform/native';
import MapPickerControls, {
  type LocalPlace,
} from './components/MapPickerControls';
import { useRecentActivity } from './data/use-recent-activity';
import { aggregateRecentBubbles, bubbleRadius } from './domain/recent-bubbles';
import {
  encodeTripUrl,
  parseTripUrl,
  routePreference,
  selectSharedRoute,
  type SharedTrip,
  type RoutePreference,
} from './domain/trip-tools';
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
  const incomingTrip = useRef<SharedTrip | null>(null);
  const area = catalog?.areas.find((item) => item.id === areaId);
  useEffect(() => {
    if (data && area && data.manifest.datasetId === area.id)
      void cacheLoadedDataset(area.datasetUrl, data);
  }, [data, area]);
  useEffect(() => {
    const reportError = (event: Event) => {
      const message: unknown = (event as CustomEvent).detail;
      if (typeof message === 'string') setNotice(message);
    };
    window.addEventListener('brisa:platformerror', reportError);
    return () => window.removeEventListener('brisa:platformerror', reportError);
  }, []);
  const recent = useRecentActivity(area);
  const [activityCategory, setActivityCategory] = useState('all');
  const [selectedActivity, setSelectedActivity] = useState<string | null>(null);
  const recentPanel = useRef<HTMLDetailsElement>(null);
  const activityBubbles = useMemo(
    () =>
      data && recent.feed
        ? aggregateRecentBubbles(
            recent.feed.records,
            data.cells,
            data.manifest.planningBounds,
            activityCategory === 'all' ? undefined : activityCategory,
          )
        : [],
    [data, recent.feed, activityCategory],
  );
  useEffect(() => {
    setActivityCategory('all');
    setSelectedActivity(null);
  }, [areaId]);
  useEffect(
    () => setSelectedActivity(null),
    [activityCategory, recent.enabled],
  );
  useEffect(() => {
    if (
      recent.feed &&
      activityCategory !== 'all' &&
      !recent.feed.records.some(
        (record) => record.category === activityCategory,
      )
    ) {
      setActivityCategory('all');
    }
  }, [recent.feed, activityCategory]);
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
  const [queries, setQueries] = useState<
    Partial<Record<'origin' | 'destination', string>>
  >({});
  const [searchTarget, setSearchTarget] = useState<
    'origin' | 'destination' | null
  >(null);
  const [locating, setLocating] = useState<'origin' | 'destination' | null>(
    null,
  );
  const locationRequest = useRef(0);
  const placeSearch = usePlaceSearch(
    data,
    area,
    searchTarget ? (queries[searchTarget] ?? '') : '',
    !!searchTarget,
  );
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
  const [mapZoom, setMapZoom] = useState(15);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapPanel = useRef<HTMLElement>(null);
  const plannerForm = useRef<HTMLFormElement>(null);
  const [customNames, setCustomNames] = useState<{
    origin?: string;
    destination?: string;
  }>({});
  const mapReference = useRef<LocalPlace | null>(null);
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
  function revealMap() {
    const panel = mapPanel.current;
    if (!panel) return;
    if (window.matchMedia('(max-width: 900px)').matches) {
      const header =
        document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
      window.scrollTo({
        top: panel.getBoundingClientRect().top + window.scrollY - header,
        behavior: 'instant',
      });
    } else panel.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }
  function returnToForm(target: 'origin' | 'destination') {
    requestAnimationFrame(() => {
      plannerForm.current?.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      });
      document.getElementById(target)?.focus({ preventScroll: true });
    });
  }
  function confirmMapPoint(target: 'origin' | 'destination', point: LngLat) {
    if (!data) return;
    const [west, south, east, north] = data.manifest.planningBounds;
    if (
      point[0] < west ||
      point[0] > east ||
      point[1] < south ||
      point[1] > north
    ) {
      setError(
        `Choose a point inside ${data.manifest.district}, ${data.manifest.city} coverage.`,
      );
      return;
    }
    const reference = mapReference.current;
    const nearReference =
      reference &&
      L.latLng(latlng(point)).distanceTo(latlng(reference.point)) < 1;
    setCustom((value) => ({ ...value, [target]: point }));
    setCustomNames((value) => ({
      ...value,
      [target]: nearReference ? `Near ${reference.name}` : undefined,
    }));
    (target === 'origin' ? setOrigin : setDestination)('custom');
    setQueries((value) => ({ ...value, [target]: undefined }));
    setSearchTarget(null);
    locationRequest.current += 1;
    setLocating(null);
    setPicking(null);
    mapReference.current = null;
    invalidatePlan();
    setNotice(
      `${target === 'origin' ? 'Start' : 'Destination'} selected on the map. Compare routes to update your walk.`,
    );
    returnToForm(target);
  }
  function endpointLabel(target: 'origin' | 'destination') {
    const id = target === 'origin' ? origin : destination;
    if (id === 'custom' && custom[target])
      return (
        customNames[target] ??
        `${custom[target]![1].toFixed(4)}, ${custom[target]![0].toFixed(4)}`
      );
    return data?.landmarks.find((item) => item.id === id)?.name ?? '';
  }
  function chooseEndpoint(
    target: 'origin' | 'destination',
    place: EndpointSuggestion,
  ) {
    if (!data) return;
    const [west, south, east, north] = data.manifest.planningBounds;
    if (
      place.point[0] < west ||
      place.point[0] > east ||
      place.point[1] < south ||
      place.point[1] > north
    ) {
      setError(
        `This place is outside ${data.manifest.district} walking coverage. Choose a place inside the boundary.`,
      );
      return;
    }
    locationRequest.current += 1;
    setLocating(null);
    const landmark =
      place.source === 'local' && place.kind === 'landmark'
        ? data.landmarks.find((item) => `landmark:${item.id}` === place.id)
        : undefined;
    (target === 'origin' ? setOrigin : setDestination)(
      landmark?.id ?? 'custom',
    );
    setCustom((value) => ({ ...value, [target]: place.point }));
    setCustomNames((value) => ({
      ...value,
      [target]: place.kind === 'street' ? `Near ${place.label}` : place.label,
    }));
    setQueries((value) => ({ ...value, [target]: undefined }));
    setSearchTarget(null);
    setPicking(null);
    mapReference.current = null;
    setNotice('');
    invalidatePlan();
  }
  function locateEndpoint(target: 'origin' | 'destination') {
    if (!canLocate()) {
      setError(
        'Location is unavailable in this browser. Search for a place or use the map.',
      );
      return;
    }
    const token = ++locationRequest.current;
    setLocating(target);
    setError('');
    requestCurrentPosition(
      (position) => {
        if (token !== locationRequest.current) return;
        setLocating(null);
        chooseEndpoint(target, {
          id: 'device-location',
          label: 'Your location',
          point: [position.coords.longitude, position.coords.latitude],
          kind: 'place',
          source: 'local',
        });
      },
      (failure) => {
        if (token !== locationRequest.current) return;
        setLocating(null);
        setError(
          failure.code === 1
            ? 'Location permission was declined. Search for a place or choose a point on the map.'
            : 'Could not get your location. Search for a place or choose a point on the map.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }
  function showActivityDetails() {
    if (!recentPanel.current) return;
    recentPanel.current.open = true;
    requestAnimationFrame(() =>
      recentPanel.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    );
  }
  const confirmPointRef = useRef(confirmMapPoint);
  confirmPointRef.current = confirmMapPoint;
  function showCoverage() {
    if (!map.current || !data) return;
    const [west, south, east, north] = data.manifest.planningBounds;
    map.current.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      {
        paddingTopLeft: [30, 105],
        paddingBottomRight: [60, 115],
        animate: false,
      },
    );
    revealMap();
  }
  function showRouteMap() {
    setFit((value) => value + 1);
    revealMap();
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
    preference?: RoutePreference,
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
      setSelected(
        (preference
          ? selectSharedRoute(comparison.routes, preference)
          : comparison.routes.at(-1)
        )?.id ?? '',
      );
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
        try {
          incomingTrip.current = parseTripUrl(window.location.href, next.areas);
          if (incomingTrip.current)
            setNotice(
              'Shared trip loaded. Routes are recalculated from this snapshot.',
            );
        } catch {
          incomingTrip.current = null;
          setNotice(
            'Shared trip could not be loaded. Showing the default landmarks; you can plan a new walk.',
          );
        }
        const chosen =
          next.areas.find((item) => item.id === requested)?.id ??
          next.defaultAreaId;
        if (
          requested &&
          requested !== chosen &&
          !new URL(window.location.href).searchParams.has('trip')
        )
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
    setCustomNames({});
    setQueries({});
    setSearchTarget(null);
    locationRequest.current += 1;
    setLocating(null);
    mapReference.current = null;
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
    // Coordinates enter the URL only through an explicit share action. Consume
    // incoming links without keeping trip coordinates in the browsing address.
    url.search = '';
    url.hash = '';
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
        const shared =
          incomingTrip.current?.areaId === area.id
            ? incomingTrip.current
            : null;
        incomingTrip.current = null;
        if (shared) {
          const request = shared.request;
          const match = (point: LngLat) =>
            dataset.landmarks.find((landmark) =>
              landmark.point.every((n, i) => Math.abs(n - point[i]) < 1e-8),
            );
          const a = match(request.origin),
            b = match(request.destination);
          setOrigin(a?.id ?? 'custom');
          setDestination(b?.id ?? 'custom');
          setCustom({
            ...(!a ? { origin: request.origin } : {}),
            ...(!b ? { destination: request.destination } : {}),
          });
          setBucket(request.bucket);
          setBudget(request.maxExtraMinutes);
          void compute(
            dataset,
            request.origin,
            request.destination,
            request.bucket,
            request.maxExtraMinutes,
            shared.preference,
          );
        } else {
          setOrigin(start.id);
          setDestination(end.id);
          void compute(dataset, start.point, end.point, 2, 8);
        }
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
    m.on('zoomend', () => setMapZoom(m.getZoom()));
    m.createPane('recent-counts').style.zIndex = '450';
    m.getPane('recent-counts')!.style.pointerEvents = 'none';
    m.fitBounds([
      [b[1], b[0]],
      [b[3], b[2]],
    ]);
    L.tileLayer(
      import.meta.env.VITE_TILE_URL ||
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        // OSM requires a Referer. Send only the site origin, never trip URLs,
        // while retaining the document's no-referrer policy for other requests.
        referrerPolicy: 'strict-origin',
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
      confirmPointRef.current(target, point);
    });
    let previousWidth = 0,
      previousHeight = 0;
    const resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      m.invalidateSize({ animate: false });
      if (!pickRef.current) fitComparison(m, comparisonRef.current);
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
          interactive: !picking,
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
          interactive: !picking,
          keyboard: !picking,
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
              interactive: !picking,
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
  }, [data, result, selected, overlay, bucket, plannedPoints, dirty, picking]);

  useEffect(() => {
    const m = map.current;
    if (!m || !data || !recent.enabled || !recent.feed) return;
    const group = L.layerGroup().addTo(m);
    activityBubbles.forEach((bubble) => {
      const active = bubble.id === selectedActivity;
      const southwest = m.latLngToLayerPoint([
        bubble.bounds[1],
        bubble.bounds[0],
      ]);
      const northeast = m.latLngToLayerPoint([
        bubble.bounds[3],
        bubble.bounds[2],
      ]);
      // Keep a fixed-area bubble inside its cell as the map zooms out.
      const cellPixels = Math.min(
        Math.abs(northeast.x - southwest.x),
        Math.abs(northeast.y - southwest.y),
      );
      const radius = Math.min(
        bubbleRadius(bubble.count),
        Math.max(3, cellPixels * 0.42),
      );
      if (active)
        L.rectangle(
          [
            [bubble.bounds[1], bubble.bounds[0]],
            [bubble.bounds[3], bubble.bounds[2]],
          ],
          {
            color: '#7040a3',
            weight: 2,
            fillOpacity: 0.06,
            dashArray: '4 3',
            interactive: false,
          },
        )
          .addTo(group)
          .bringToBack();
      const description = document.createElement('span');
      description.textContent = `${bubble.count} ${recent.source?.kind === 'calls' ? 'unverified calls' : 'published reports'} · approximate 250 m cell`;
      L.circleMarker(latlng(bubble.center), {
        radius,
        color: active ? '#442469' : '#7040a3',
        weight: active ? 3 : 1.5,
        fillColor: '#cbb0e4',
        fillOpacity: active ? 0.8 : 0.38,
        interactive: !picking,
        bubblingMouseEvents: false,
      })
        .bindTooltip(description)
        .on('click', () => {
          if (pickRef.current) return;
          setSelectedActivity(bubble.id);
          if (recentPanel.current) recentPanel.current.open = true;
          requestAnimationFrame(() =>
            recentPanel.current
              ?.querySelector('.recent-selection')
              ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
          );
        })
        .addTo(group)
        .bringToBack();
      const label = document.createElement('span');
      label.textContent = radius >= 9 ? String(bubble.count) : '';
      L.marker(latlng(bubble.center), {
        pane: 'recent-counts',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'activity-count',
          html: label,
          iconSize: [radius * 2, radius * 2],
          iconAnchor: [radius, radius],
        }),
      }).addTo(group);
    });
    return () => {
      group.remove();
    };
  }, [
    data,
    recent.enabled,
    recent.feed,
    recent.source,
    activityBubbles,
    selectedActivity,
    picking,
    mapZoom,
  ]);

  useEffect(() => {
    if (map.current && !pickRef.current) fitComparison(map.current, result);
  }, [fit, result]);
  useEffect(() => {
    if (details) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [details]);
  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    void import('@capacitor/app').then(async ({ App: NativeApp }) => {
      if (disposed) return;
      const listener = await NativeApp.addListener('backButton', () => {
        if (details) {
          setDetails(false);
        } else if (picking) {
          setPicking(null);
          mapReference.current = null;
          returnToForm(picking);
        } else {
          const focused = document.activeElement;
          if (
            focused?.matches('input[role="combobox"][aria-expanded="true"]')
          ) {
            focused.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              }),
            );
          } else if (window.scrollY > 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            void NativeApp.minimizeApp();
          }
        }
      });
      if (disposed) await listener.remove();
      else remove = () => listener.remove();
    });
    return () => {
      disposed = true;
      void remove?.();
    };
  }, [details, picking]);
  useEffect(() => {
    if (picking) {
      revealMap();
      mapEl.current?.focus({ preventScroll: true });
    }
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
        <a
          href={import.meta.env.BASE_URL}
          className="brand"
          aria-label="Brisa home"
        >
          <span className="brand-symbol">
            <Navigation size={23} fill="currentColor" />
          </span>
          brisa<span className="brand-dot">.</span>
        </a>
        <span className="header-divider" />
        <span className="header-context">Walking directions</span>
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
            <h1>Plan a walk</h1>
            <span>With local report context</span>
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
                    if (event.target.value === areaId) return;
                    incomingTrip.current = null;
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
                ref={plannerForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  const a = resolve('origin'),
                    b = resolve('destination');
                  if (a && b) {
                    setSearchTarget(null);
                    compute(data, a, b);
                  } else
                    setError(
                      'Choose both locations from the suggestions or on the map before finding routes.',
                    );
                }}
              >
                <div className="endpoint-fields">
                  {(['origin', 'destination'] as const).map((key, index) => (
                    <EndpointSearch
                      key={`${areaId}:${key}`}
                      id={key}
                      label={index ? 'To' : 'From'}
                      value={queries[key] ?? endpointLabel(key)}
                      selected={
                        queries[key] === undefined && !!endpointLabel(key)
                      }
                      onValueChange={(value) => {
                        locationRequest.current += 1;
                        setLocating(null);
                        setQueries((previous) => ({
                          ...previous,
                          [key]: value,
                        }));
                        (key === 'origin' ? setOrigin : setDestination)('');
                        setNotice('');
                        invalidatePlan();
                      }}
                      onSearchActiveChange={(active) =>
                        setSearchTarget((current) =>
                          active ? key : current === key ? null : current,
                        )
                      }
                      onSelect={(place) => chooseEndpoint(key, place)}
                      results={searchTarget === key ? placeSearch.results : []}
                      loading={searchTarget === key && placeSearch.loading}
                      error={searchTarget === key ? placeSearch.error : ''}
                      providerDisclosure={GEOCODER_ATTRIBUTION.disclosure}
                      providerLink={GEOCODER_ATTRIBUTION}
                      onMapSelect={() => {
                        locationRequest.current += 1;
                        setLocating(null);
                        setSearchTarget(null);
                        setError('');
                        mapReference.current = null;
                        setPicking(key);
                        showCoverage();
                      }}
                      onLocateCurrent={
                        key === 'origin' ? () => locateEndpoint(key) : undefined
                      }
                      locating={locating === key}
                    />
                  ))}
                  <button
                    className="swap-button"
                    type="button"
                    aria-label="Swap start and destination"
                    onClick={() => {
                      locationRequest.current += 1;
                      setLocating(null);
                      setSearchTarget(null);
                      setOrigin(destination);
                      setDestination(origin);
                      setQueries({
                        origin: queries.destination,
                        destination: queries.origin,
                      });
                      setCustom({
                        origin: custom.destination,
                        destination: custom.origin,
                      });
                      setCustomNames({
                        origin: customNames.destination,
                        destination: customNames.origin,
                      });
                      invalidatePlan();
                    }}
                  >
                    <ArrowDownUp size={16} />
                  </button>
                </div>
                <details className="advanced-options">
                  <summary>
                    Advanced options{' '}
                    <span>
                      {windows[bucket]} · +{budget} min
                    </span>
                  </summary>
                  <div className="advanced-content">
                    <AppInstall />
                    <div className="planner-actions">
                      <span>Restore the sample route</span>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => {
                          if (!area) return;
                          const start = data.landmarks.find(
                            (item) => item.id === area.defaultOriginId,
                          );
                          const end = data.landmarks.find(
                            (item) => item.id === area.defaultDestinationId,
                          );
                          if (!start || !end) return;
                          incomingTrip.current = null;
                          setOrigin(start.id);
                          setDestination(end.id);
                          setCustom({});
                          setCustomNames({});
                          setPicking(null);
                          mapReference.current = null;
                          setBucket(2);
                          setBudget(8);
                          setQueries({});
                          setSearchTarget(null);
                          locationRequest.current += 1;
                          setLocating(null);
                          setNotice('Example walk restored.');
                          void compute(data, start.point, end.point, 2, 8);
                        }}
                      >
                        Try example walk
                      </button>
                    </div>
                    <label className="field-label" htmlFor="time-window">
                      Historical time window{' '}
                      <span>{data.manifest.timezone}</span>
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
                    {data && (
                      <>
                        <div className="coverage-meta">
                          <span>Bounded walking area · {period}</span>
                          <button
                            className="quiet-button"
                            type="button"
                            onClick={showCoverage}
                          >
                            <Scan size={14} /> Show coverage
                          </button>
                        </div>
                        <details className="coverage-details">
                          <summary>Coverage and source details</summary>
                          <p className="coverage-description">
                            {area?.description}
                          </p>
                          <p className="coverage-source">
                            Source: {data.manifest.sourceName}
                          </p>
                          <p>
                            {data.manifest.eligibleReportCount.toLocaleString()}{' '}
                            eligible historical reports · {period}
                          </p>
                        </details>
                      </>
                    )}
                  </div>
                </details>
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
            </>
          )}
        </aside>
        <div className="map-workspace">
          <section
            ref={mapPanel}
            className={`map-panel ${picking ? 'picking' : ''}`}
            aria-label="Interactive walking route map"
          >
            <div
              key={data?.manifest.datasetId ?? 'unloaded'}
              ref={mapEl}
              className="map-canvas"
              tabIndex={0}
              role="region"
              aria-label={
                picking
                  ? `Map for choosing ${picking}. Use arrow keys to pan, then confirm with Use map center.`
                  : 'Walking map'
              }
            />
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
                  title="Fit routes to map"
                  disabled={!route || !!picking}
                >
                  <LocateFixed size={19} />
                </button>
                <button
                  onClick={showCoverage}
                  aria-label="Show coverage boundary"
                  title="Show coverage boundary"
                >
                  <Scan size={19} />
                </button>
              </div>
            )}
            {picking && (
              <div className="map-center-marker" aria-hidden="true">
                <span>+</span>
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
                  <button
                    className="intensity-toggle activity-layer-toggle"
                    aria-pressed={recent.enabled}
                    onClick={recent.onToggle}
                  >
                    <span>
                      <i className="activity-key" /> Latest activity bubbles
                    </span>
                    <span className={`toggle ${recent.enabled ? 'on' : ''}`} />
                  </button>
                  {recent.enabled && (
                    <p className="legend-caveat activity-legend-note">
                      {recent.loading
                        ? 'Checking source…'
                        : recent.error
                          ? 'Update unavailable · see details'
                          : recent.source?.kind === 'calls'
                            ? 'Dispatch updates · delayed'
                            : recent.feed
                              ? `Report window ends ${recent.feed.windowEnd.slice(0, 10)}`
                              : 'See source availability'}
                      <button onClick={showActivityDetails}>
                        Details & dates
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
            {tileError && (
              <div className="tile-status" role="status">
                Base tiles unavailable · bundled streets shown
              </div>
            )}
          </section>
          {route && (
            <button
              className="route-map-label"
              onClick={() =>
                document
                  .querySelector('.results')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              aria-label="View selected walk details"
            >
              <Footprints size={16} />
              <span className="route-label-action">View tradeoff</span>
              <strong className="route-label-metric">
                {Math.ceil(route.minutes)} min
              </strong>
              <span className="route-label-metric">
                · {distance(route.meters)}
              </span>
              <ArrowRight size={14} />
            </button>
          )}
          {picking && data && (
            <MapPickerControls
              key={`${areaId}:${picking}`}
              data={data}
              target={picking}
              error={error}
              onCancel={() => {
                const target = picking;
                setPicking(null);
                setError('');
                mapReference.current = null;
                returnToForm(target);
              }}
              onUseCenter={() => {
                const center = map.current?.getCenter();
                if (center) confirmMapPoint(picking, [center.lng, center.lat]);
              }}
              onFocusMap={() => {
                revealMap();
                mapEl.current?.focus({ preventScroll: true });
              }}
              onLocate={(place) => {
                mapReference.current = place;
                map.current?.setView(latlng(place.point), 17, {
                  animate: false,
                });
                revealMap();
              }}
            />
          )}
        </div>
        <section
          className="results-panel"
          aria-label="Walking options and context"
        >
          {data && (
            <>
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
                {route && result && (
                  <RouteDecision
                    route={route}
                    comparison={result}
                    data={data}
                    period={period}
                  />
                )}
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
                              : `${r.reductionPercent > 0 && r.reductionPercent < 1 ? '<1' : Math.round(r.reductionPercent)}% lower`}
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
                    Historical report index, not a safety prediction. Compare
                    routes within this area.
                  </span>
                </p>
                {route && area && plannedPoints && (
                  <WalkDetails
                    key={`${area.id}:${route.id}:${bucket}:${budget}`}
                    route={route}
                    manifest={data.manifest}
                    bucket={bucket}
                    budget={budget}
                    showMap={showRouteMap}
                    createShareUrl={() =>
                      encodeTripUrl(tripEncodingBase(window.location.href), {
                        areaId: area.id,
                        cityId: area.cityId,
                        request: {
                          origin: plannedPoints.origin,
                          destination: plannedPoints.destination,
                          bucket,
                          maxExtraMinutes: budget,
                        },
                        preference: routePreference(route),
                      })
                    }
                  />
                )}
              </section>
              {area && (
                <details className="activity-details" ref={recentPanel}>
                  <summary>
                    Activity details <span>{recent.statusLabel}</span>
                  </summary>
                  <RecentReports
                    area={area}
                    {...recent}
                    bubbles={activityBubbles}
                    selectedId={selectedActivity}
                    category={activityCategory}
                    onCategoryChange={setActivityCategory}
                    onSelect={(id) => {
                      setSelectedActivity(id);
                      const bubble = activityBubbles.find(
                        (item) => item.id === id,
                      );
                      if (
                        bubble &&
                        map.current &&
                        !map.current.getBounds().contains(latlng(bubble.center))
                      )
                        map.current.panTo(latlng(bubble.center));
                    }}
                  />
                </details>
              )}
            </>
          )}
          <div className="planner-footer">
            <span className="snapshot-dot" />
            {data ? `${period} snapshot` : 'Historical report snapshots'}
            <button disabled={!data} onClick={() => setDetails(true)}>
              Data & method <ArrowUpRight size={13} />
            </button>
          </div>
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
              source records.
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
            <details className="provenance-details">
              <summary>Source filters, limitations & provenance</summary>
              {data.manifest.notes.map((n, i) => (
                <p key={i} className="source-note">
                  {n}
                </p>
              ))}
            </details>
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
