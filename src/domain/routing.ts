import type {
  Bounds,
  CityDataset,
  LngLat,
  PlanRequest,
  PlannedRoute,
  RouteComparison,
  StreetEdge,
} from './types';

export class RoutingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}
const fail = (code: string, message: string): never => {
  throw new RoutingError(code, message);
};
const inside = (p: LngLat, b: Bounds) =>
  p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export function haversine(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad,
    dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
interface Arc {
  edge: StreetEdge;
  to: string;
  reverse: boolean;
  meters: number;
  minutes: number;
  exposure: number;
}
type Graph = Map<string, Arc[]>;
const cache = new WeakMap<CityDataset, Map<number, Graph>>();
function graphFor(data: CityDataset, bucket: number): Graph {
  let buckets = cache.get(data);
  if (!buckets) {
    buckets = new Map();
    cache.set(data, buckets);
  }
  const cached = buckets.get(bucket);
  if (cached) return cached;
  const graph: Graph = new Map(data.nodes.map((n) => [n.id, []]));
  for (const edge of data.edges) {
    if (
      !graph.has(edge.from) ||
      !graph.has(edge.to) ||
      edge.coordinates.length < 2 ||
      edge.coordinates.some(
        (point) =>
          !point.every(Number.isFinite) ||
          !inside(point, data.manifest.planningBounds),
      )
    )
      continue;
    let meters = 0,
      exposure = 0,
      supported = true;
    for (let i = 1; i < edge.coordinates.length; i++) {
      const a = edge.coordinates[i - 1],
        b = edge.coordinates[i];
      const length = haversine(a, b),
        count = Math.max(1, Math.ceil(length / 25));
      if (!Number.isFinite(length)) {
        supported = false;
        break;
      }
      meters += length;
      for (let j = 0; j < count; j++) {
        const t = (j + 0.5) / count;
        const p: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const value = data.cells.find((cell) => inside(p, cell.bounds))
          ?.intensity[bucket];
        if (
          value === undefined ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1
        ) {
          supported = false;
          break;
        }
        exposure += (length / count / 81) * value;
      }
      if (!supported) break;
    }
    // Unsupported coverage removes an edge; it must never become a zero-cost corridor.
    if (!supported || meters <= 0) continue;
    const arc = {
      edge,
      to: edge.to,
      reverse: false,
      meters,
      minutes: meters / 81,
      exposure,
    };
    graph.get(edge.from)!.push(arc);
    if (edge.bidirectional)
      graph.get(edge.to)!.push({ ...arc, to: edge.from, reverse: true });
  }
  buckets.set(bucket, graph);
  return graph;
}
class Heap {
  items: { id: string; cost: number }[] = [];
  push(item: { id: string; cost: number }) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= item.cost) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].cost < this.items[child].cost
        )
          child++;
        if (this.items[child].cost >= last.cost) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}
function shortest(
  graph: Graph,
  origin: string,
  destination: string,
  lambda: number,
): Arc[] | null {
  const distances = new Map([[origin, 0]]),
    previous = new Map<string, { from: string; arc: Arc }>();
  const heap = new Heap();
  heap.push({ id: origin, cost: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== distances.get(current.id)) continue;
    if (current.id === destination) {
      const path: Arc[] = [];
      let id = destination;
      while (id !== origin) {
        const step = previous.get(id)!;
        path.push(step.arc);
        id = step.from;
      }
      return path.reverse();
    }
    for (const arc of graph.get(current.id) ?? []) {
      const cost = current.cost + arc.minutes + lambda * arc.exposure;
      if (cost < (distances.get(arc.to) ?? Infinity)) {
        distances.set(arc.to, cost);
        previous.set(arc.to, { from: current.id, arc });
        heap.push({ id: arc.to, cost });
      }
    }
  }
  return null;
}
function route(path: Arc[], origin: string): PlannedRoute {
  const result: PlannedRoute = {
    id: '',
    label: '',
    nodeIds: [origin],
    edgeIds: [],
    coordinates: [],
    meters: 0,
    minutes: 0,
    exposure: 0,
    extraMinutes: 0,
    reductionPercent: null,
    segments: [],
  };
  for (const arc of path) {
    result.nodeIds.push(arc.to);
    result.edgeIds.push(arc.edge.id);
    const coordinates = arc.reverse
      ? [...arc.edge.coordinates].reverse()
      : arc.edge.coordinates;
    result.coordinates.push(
      ...(result.coordinates.length ? coordinates.slice(1) : coordinates),
    );
    result.meters += arc.meters;
    result.minutes += arc.minutes;
    result.exposure += arc.exposure;
    const name = arc.edge.name || 'Unnamed walking connection',
      last = result.segments.at(-1);
    if (last?.name === name) {
      last.meters += arc.meters;
      last.minutes += arc.minutes;
      last.exposure += arc.exposure;
    } else
      result.segments.push({
        name,
        meters: arc.meters,
        minutes: arc.minutes,
        exposure: arc.exposure,
      });
  }
  result.id = JSON.stringify(result.edgeIds);
  return result;
}
export function planRoutes(
  data: CityDataset,
  request: PlanRequest,
): RouteComparison {
  for (const point of [request.origin, request.destination]) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every(Number.isFinite) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 90
    )
      fail(
        'INVALID_COORDINATES',
        'Choose valid origin and destination coordinates.',
      );
    if (!inside(point, data.manifest.planningBounds))
      fail(
        'OUTSIDE_COVERAGE',
        'Choose both points inside the supported planning area.',
      );
  }
  if (
    ![0, 1, 2, 3].includes(request.bucket) ||
    !Number.isFinite(request.maxExtraMinutes) ||
    request.maxExtraMinutes < 0
  )
    fail(
      'INVALID_REQUEST',
      'Choose a valid historical time window and a nonnegative extra walking time.',
    );
  const snap = (point: LngLat) => {
    let node = data.nodes[0],
      distance = Infinity;
    for (const candidate of data.nodes) {
      if (!inside(candidate.point, data.manifest.planningBounds)) continue;
      const d = haversine(point, candidate.point);
      if (d < distance) {
        node = candidate;
        distance = d;
      }
    }
    if (!node || distance > 75)
      fail(
        'SNAP_TOO_FAR',
        'A point is more than 75 m from a supported street node. Choose a nearby street intersection.',
      );
    return { node, distance };
  };
  const start = snap(request.origin),
    end = snap(request.destination);
  if (start.node.id === end.node.id)
    fail(
      'SAME_ENDPOINT',
      'Both points snap to the same street node. Choose a farther destination.',
    );
  const graph = graphFor(data, request.bucket),
    fastestPath = shortest(graph, start.node.id, end.node.id, 0);
  if (!fastestPath)
    fail(
      'DISCONNECTED',
      'No connected walking route with complete scoring coverage joins these points.',
    );
  const fastest = route(fastestPath!, start.node.id),
    candidates = new Map([[fastest.id, fastest]]);
  const lambdas = [
    0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
  ];
  for (const lambda of lambdas) {
    const path = shortest(graph, start.node.id, end.node.id, lambda);
    if (path) {
      const candidate = route(path, start.node.id);
      if (candidate.minutes <= fastest.minutes + request.maxExtraMinutes)
        candidates.set(candidate.id, candidate);
    }
  }
  const all = [...candidates.values()];
  const frontier = all.filter(
    (a) =>
      a.id === fastest.id ||
      !all.some(
        (b) =>
          b.id !== a.id &&
          b.minutes <= a.minutes &&
          b.exposure <= a.exposure &&
          (b.minutes < a.minutes || b.exposure < a.exposure),
      ),
  );
  const lower = frontier
    .filter((r) => r.exposure < fastest.exposure - 1e-10)
    .sort((a, b) => a.exposure - b.exposure || a.minutes - b.minutes)[0];
  const balanced = lower
    ? frontier
        .filter(
          (r) =>
            r.id !== fastest.id &&
            r.id !== lower.id &&
            r.exposure < fastest.exposure - 1e-10,
        )
        .sort(
          (a, b) =>
            Math.abs(a.minutes - (fastest.minutes + lower.minutes) / 2) -
            Math.abs(b.minutes - (fastest.minutes + lower.minutes) / 2),
        )[0]
    : undefined;
  const routes = [
    fastest,
    ...(balanced ? [balanced] : []),
    ...(lower ? [lower] : []),
  ];
  for (const r of routes) {
    r.label =
      r.id === fastest.id
        ? 'Fastest'
        : r.id === lower?.id
          ? 'Lower modeled exposure'
          : 'Balanced';
    r.extraMinutes = r.minutes - fastest.minutes;
    r.reductionPercent =
      fastest.exposure > 1e-8
        ? Math.max(
            0,
            ((fastest.exposure - r.exposure) / fastest.exposure) * 100,
          )
        : null;
  }
  return {
    routes,
    snappedOrigin: start.node.point,
    snappedDestination: end.node.point,
    originSnapMeters: start.distance,
    destinationSnapMeters: end.distance,
    evaluatedCandidates: lambdas.length + 1,
    message:
      routes.length === 1
        ? 'No distinct lower-exposure alternative was found within this walking-time budget.'
        : null,
  };
}
