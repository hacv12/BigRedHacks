/** Geographic coordinates always use GeoJSON order: longitude, latitude. */
export type LngLat = [number, number];
export type Bounds = [number, number, number, number]; // west, south, east, north
export type BucketIndex = 0 | 1 | 2 | 3;
export type FourValues = [number, number, number, number];

export interface StreetNode { id: string; point: LngLat }
export interface StreetEdge {
  id: string;
  from: string;
  to: string;
  coordinates: LngLat[];
  meters: number;
  name: string;
  bidirectional: boolean;
}
export interface IncidentCell {
  id: string;
  center: LngLat;
  bounds: Bounds;
  counts: FourValues;
  weighted: FourValues;
  intensity: FourValues;
  total: number;
}
export interface Landmark { id: string; name: string; point: LngLat }
export interface DataManifest {
  city: string;
  district: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  downloadedAt: string;
  sourceUrl: string;
  osmSourceUrl: string;
  osmTimestamp: string;
  planningBounds: Bounds;
  incidentBounds: Bounds;
  cellSizeMeters: number;
  sourceReportCount: number;
  eligibleReportCount: number;
  excludedReportCount: number;
  missingCoordinateCount: number;
  categoryWeights: Record<string, number>;
  timeBuckets: [string, string, string, string];
  modelVersion: string;
  normalization: number;
  notes: string[];
}
export interface CityDataset {
  manifest: DataManifest;
  nodes: StreetNode[];
  edges: StreetEdge[];
  cells: IncidentCell[];
  landmarks: Landmark[];
}
export interface RouteSegment { name: string; meters: number; minutes: number; exposure: number }
export interface PlannedRoute {
  id: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  coordinates: LngLat[];
  meters: number;
  minutes: number;
  exposure: number;
  extraMinutes: number;
  reductionPercent: number | null;
  segments: RouteSegment[];
}
export interface PlanRequest {
  origin: LngLat;
  destination: LngLat;
  bucket: BucketIndex;
  maxExtraMinutes: number;
}
export interface RouteComparison {
  routes: PlannedRoute[];
  snappedOrigin: LngLat;
  snappedDestination: LngLat;
  originSnapMeters: number;
  destinationSnapMeters: number;
  evaluatedCandidates: number;
  message: string | null;
}
