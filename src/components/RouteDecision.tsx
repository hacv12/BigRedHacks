import { useMemo } from 'react';
import { compareRoutes } from '../domain/route-insights';
import type {
  CityDataset,
  PlannedRoute,
  RouteComparison,
} from '../domain/types';

interface Props {
  route: PlannedRoute;
  comparison: RouteComparison;
  data: CityDataset;
  period: string;
}
const meters = (value: number) =>
  value < 1000
    ? `${Math.round(value / 10) * 10} m`
    : `${(value / 1000).toFixed(1)} km`;

export default function RouteDecision({
  route,
  comparison,
  data,
  period,
}: Props) {
  const fastest = comparison.routes[0];
  const insight = useMemo(
    () => compareRoutes(route, fastest, data),
    [route, fastest, data],
  );
  const differs = route.id !== fastest.id;
  return (
    <section className="route-decision" aria-label="Selected route comparison">
      <span className="eyebrow">YOUR WALKING TRADEOFF</span>
      <p className="decision-takeaway">{insight.takeaway}</p>
      <p className="decision-context">
        {period} historical reports · not a safety prediction.
      </p>
      {differs && (
        <details className="route-differences">
          <summary>What changes from fastest?</summary>
          <p>{insight.streetSummary}</p>
          <dl>
            <div>
              <dt>Shared street geometry</dt>
              <dd>{meters(insight.sharedMeters)}</dd>
            </div>
            <div>
              <dt>Different sections on this walk</dt>
              <dd>{meters(insight.selectedOnlyMeters)}</dd>
            </div>
            <div>
              <dt>Different sections on fastest</dt>
              <dd>{meters(insight.fastestOnlyMeters)}</dd>
            </div>
            <div>
              <dt>Net added distance</dt>
              <dd>{meters(Math.max(0, insight.addedMeters))}</dd>
            </div>
          </dl>
          <p>
            Street sections explain the geometry difference. They do not
            establish why incidents occurred or verify current access.
          </p>
        </details>
      )}
      {(comparison.originSnapMeters > 5 ||
        comparison.destinationSnapMeters > 5) && (
        <p className="decision-connections">
          Street endpoints are {Math.round(comparison.originSnapMeters)} m from
          your start and {Math.round(comparison.destinationSnapMeters)} m from
          your destination. Time and index estimates cover the street path;
          these connecting distances are not included.
        </p>
      )}
    </section>
  );
}
