import type {
  Bounds,
  CityCatalog,
  CityDataset,
  CoverageArea,
  LngLat,
} from '../domain/types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;
const validPoint = (value: unknown): value is LngLat =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(finite) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;
const validBounds = (value: unknown): value is Bounds =>
  Array.isArray(value) &&
  value.length === 4 &&
  validPoint(value.slice(0, 2)) &&
  validPoint(value.slice(2)) &&
  value[0] < value[2] &&
  value[1] < value[3];
const inside = (point: LngLat, bounds: Bounds) =>
  point[0] >= bounds[0] &&
  point[0] <= bounds[2] &&
  point[1] >= bounds[1] &&
  point[1] <= bounds[3];
const close = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const validDate = (value: unknown): value is string =>
  text(value) &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function timezone(value: unknown): boolean {
  if (!text(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
function sourceUrl(value: unknown): boolean {
  if (!text(value)) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateCatalog(value: unknown): CityCatalog {
  const invalid =
    'The city catalog is invalid. Please retry or contact the project team.';
  requireValue(
    object(value) &&
      value.version === 1 &&
      text(value.defaultAreaId) &&
      Array.isArray(value.areas) &&
      value.areas.length > 0,
    invalid,
  );
  const ids = new Set<string>();
  for (const area of value.areas) {
    requireValue(object(area), invalid);
    for (const key of [
      'id',
      'cityId',
      'city',
      'region',
      'regionCode',
      'countryCode',
      'description',
      'defaultOriginId',
      'defaultDestinationId',
    ])
      requireValue(text(area[key]), invalid);
    requireValue(
      typeof area.id === 'string' &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(area.id) &&
        !ids.has(area.id),
      invalid,
    );
    ids.add(area.id);
    requireValue(
      text(area.datasetUrl) &&
        /^\/data\/[a-z0-9][a-z0-9._-]*\.json$/.test(area.datasetUrl),
      invalid,
    );
    requireValue(validBounds(area.bounds) && timezone(area.timezone), invalid);
    requireValue(
      validDate(area.periodStart) &&
        validDate(area.periodEnd) &&
        area.periodStart <= area.periodEnd,
      invalid,
    );
    requireValue(area.defaultOriginId !== area.defaultDestinationId, invalid);
  }
  requireValue(ids.has(value.defaultAreaId), invalid);
  return value as unknown as CityCatalog;
}

/** Validate once on load, before an external data package reaches the map/worker. */
export function validateDataset(
  value: unknown,
  area: CoverageArea,
): CityDataset {
  const invalid = `The ${area.city} · ${area.region} data package is incomplete or incompatible. Try another area or retry.`;
  requireValue(object(value) && object(value.manifest), invalid);
  const m = value.manifest;
  requireValue(
    m.schemaVersion === 1 &&
      m.datasetId === area.id &&
      m.cityId === area.cityId,
    invalid,
  );
  requireValue(
    m.city === area.city &&
      m.district === area.region &&
      m.timezone === area.timezone &&
      m.periodStart === area.periodStart &&
      m.periodEnd === area.periodEnd,
    invalid,
  );
  requireValue(
    validBounds(m.planningBounds) &&
      m.planningBounds.every((n, i) => close(n, area.bounds[i])),
    invalid,
  );
  requireValue(
    validBounds(m.incidentBounds) &&
      inside([area.bounds[0], area.bounds[1]], m.incidentBounds) &&
      inside([area.bounds[2], area.bounds[3]], m.incidentBounds),
    invalid,
  );
  for (const key of [
    'sourceName',
    'sourceAdapter',
    'coverageDescription',
    'modelVersion',
    'downloadedAt',
    'osmTimestamp',
  ])
    requireValue(text(m[key]), invalid);
  requireValue(
    Number.isFinite(Date.parse(m.downloadedAt as string)) &&
      Number.isFinite(Date.parse(m.osmTimestamp as string)),
    invalid,
  );
  requireValue(sourceUrl(m.sourceUrl) && sourceUrl(m.osmSourceUrl), invalid);
  requireValue(Array.isArray(m.notes) && m.notes.every(text), invalid);
  requireValue(
    Array.isArray(m.timeBuckets) &&
      m.timeBuckets.length === 4 &&
      m.timeBuckets.every(text),
    invalid,
  );
  requireValue(
    finite(m.normalization) &&
      m.normalization > 0 &&
      finite(m.cellSizeMeters) &&
      m.cellSizeMeters > 0,
    invalid,
  );
  requireValue(
    object(m.categoryWeights) &&
      Object.keys(m.categoryWeights).length > 0 &&
      Object.values(m.categoryWeights).every((w) => finite(w) && w > 0),
    invalid,
  );
  requireValue(
    count(m.sourceReportCount) &&
      count(m.eligibleReportCount) &&
      count(m.excludedReportCount) &&
      count(m.missingCoordinateCount),
    invalid,
  );
  requireValue(
    m.sourceReportCount === m.eligibleReportCount + m.excludedReportCount,
    invalid,
  );
  requireValue(m.missingCoordinateCount <= m.excludedReportCount, invalid);
  // The scoring kernel requires neighboring cells beyond every planning edge.
  const [pw, ps, pe, pn] = m.planningBounds;
  const [iw, is, ie, north] = m.incidentBounds;
  const metersPerLongitude =
    111320 * Math.cos((((ps + pn) / 2) * Math.PI) / 180);
  const margin = Math.max(500, 2 * m.cellSizeMeters);
  requireValue(
    (pw - iw) * metersPerLongitude >= margin &&
      (ie - pe) * metersPerLongitude >= margin &&
      (ps - is) * 111320 >= margin &&
      (north - pn) * 111320 >= margin,
    invalid,
  );
  requireValue(
    Array.isArray(value.cells) &&
      value.cells.length > 0 &&
      Array.isArray(value.nodes) &&
      value.nodes.length > 1 &&
      Array.isArray(value.edges) &&
      value.edges.length > 0 &&
      Array.isArray(value.landmarks) &&
      value.landmarks.length > 1,
    invalid,
  );

  const cellIds = new Set<string>();
  let total = 0;
  for (const c of value.cells) {
    requireValue(
      object(c) &&
        text(c.id) &&
        !cellIds.has(c.id) &&
        validBounds(c.bounds) &&
        validPoint(c.center) &&
        inside(c.center, c.bounds),
      invalid,
    );
    cellIds.add(c.id);
    requireValue(
      count(c.total) &&
        Array.isArray(c.counts) &&
        c.counts.length === 4 &&
        c.counts.every(count) &&
        c.counts.reduce((sum: number, n: number) => sum + n, 0) === c.total,
      invalid,
    );
    requireValue(
      Array.isArray(c.weighted) &&
        c.weighted.length === 4 &&
        c.weighted.every((n) => finite(n) && n >= 0),
      invalid,
    );
    requireValue(
      Array.isArray(c.intensity) &&
        c.intensity.length === 4 &&
        c.intensity.every((n) => finite(n) && n >= 0 && n <= 1),
      invalid,
    );
    total += c.total;
  }
  requireValue(total === m.eligibleReportCount, invalid);
  // A complete, regular grid makes zero-report coverage distinct from missing cells.
  const cells = value.cells as CityDataset['cells'];
  const west = m.incidentBounds[0],
    south = m.incidentBounds[1];
  const width = cells[0].bounds[2] - cells[0].bounds[0],
    height = cells[0].bounds[3] - cells[0].bounds[1];
  const nx = Math.round((m.incidentBounds[2] - west) / width),
    ny = Math.round((m.incidentBounds[3] - south) / height);
  requireValue(nx > 0 && ny > 0 && nx * ny === cells.length, invalid);
  const positions = new Set<string>();
  for (const c of cells) {
    const x = Math.round((c.bounds[0] - west) / width),
      y = Math.round((c.bounds[1] - south) / height);
    const key = `${x}:${y}`;
    requireValue(
      x >= 0 &&
        x < nx &&
        y >= 0 &&
        y < ny &&
        !positions.has(key) &&
        close(c.bounds[0], west + x * width) &&
        close(c.bounds[1], south + y * height) &&
        close(c.bounds[2], west + (x + 1) * width) &&
        close(c.bounds[3], south + (y + 1) * height),
      invalid,
    );
    positions.add(key);
  }
  requireValue(
    close(west + nx * width, m.incidentBounds[2]) &&
      close(south + ny * height, m.incidentBounds[3]),
    invalid,
  );

  const nodes = new Map<string, LngLat>();
  for (const node of value.nodes) {
    requireValue(
      object(node) &&
        text(node.id) &&
        !nodes.has(node.id) &&
        validPoint(node.point) &&
        inside(node.point, m.planningBounds),
      invalid,
    );
    nodes.set(node.id, node.point);
  }
  const edgeIds = new Set<string>();
  for (const edge of value.edges) {
    requireValue(
      object(edge) &&
        text(edge.id) &&
        !edgeIds.has(edge.id) &&
        typeof edge.from === 'string' &&
        typeof edge.to === 'string' &&
        nodes.has(edge.from) &&
        nodes.has(edge.to),
      invalid,
    );
    edgeIds.add(edge.id);
    requireValue(
      Array.isArray(edge.coordinates) &&
        edge.coordinates.length >= 2 &&
        edge.coordinates.every(
          (p) => validPoint(p) && inside(p, m.planningBounds as Bounds),
        ) &&
        typeof edge.name === 'string' &&
        finite(edge.meters) &&
        edge.meters > 0 &&
        typeof edge.bidirectional === 'boolean',
      invalid,
    );
    const points = edge.coordinates as LngLat[];
    requireValue(
      points[0].every((n, i) => close(n, nodes.get(edge.from as string)![i])) &&
        points
          .at(-1)!
          .every((n, i) => close(n, nodes.get(edge.to as string)![i])),
      invalid,
    );
  }
  const landmarks = new Set<string>();
  for (const landmark of value.landmarks) {
    requireValue(
      object(landmark) &&
        text(landmark.id) &&
        !landmarks.has(landmark.id) &&
        text(landmark.name) &&
        validPoint(landmark.point) &&
        inside(landmark.point, m.planningBounds),
      invalid,
    );
    landmarks.add(landmark.id);
  }
  requireValue(
    landmarks.has(area.defaultOriginId) &&
      landmarks.has(area.defaultDestinationId),
    invalid,
  );
  return value as unknown as CityDataset;
}

async function readJson(
  url: string,
  message: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let rejectCancellation!: (reason: unknown) => void;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const cancel = (reason: unknown) => {
    rejectCancellation(reason);
    controller.abort(reason);
  };
  const abort = () => cancel(signal!.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => cancel(new Error(`${message} The download timed out. Please retry.`)),
    timeoutMs,
  );
  const download = async (): Promise<unknown> => {
    const response = await fetch(url, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new Error(message);
    try {
      const value: unknown = await response.json();
      controller.signal.throwIfAborted();
      return value;
    } catch (error) {
      controller.signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new Error(message);
    }
  };
  try {
    // Also bounds implementations/streams that do not honor AbortSignal.
    return await Promise.race([cancellation, download()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function loadCatalog(signal?: AbortSignal): Promise<CityCatalog> {
  return validateCatalog(
    await readJson(
      `${import.meta.env.BASE_URL}data/catalog.json`,
      'Unable to load the city catalog. Please retry.',
      signal,
    ),
  );
}
export async function loadDataset(
  area: CoverageArea,
  signal?: AbortSignal,
): Promise<CityDataset> {
  return validateDataset(
    await readJson(
      `${import.meta.env.BASE_URL}${area.datasetUrl.slice(1)}`,
      `Unable to load the ${area.city} · ${area.region} snapshot. Try another area or retry.`,
      signal,
      60_000,
    ),
    area,
  );
}
