import { useRef, useState } from 'react';
import { Check, Copy, Download, Map, Route, Share2 } from 'lucide-react';
import type { BucketIndex, DataManifest, PlannedRoute } from '../domain/types';
import { exportRouteGpx, exportRouteText } from '../domain/trip-tools';
import {
  copyText,
  exportFile,
  getShareableTripUrl,
  isNativePlatform,
  shareText,
} from '../platform/native';

interface Props {
  route: PlannedRoute;
  manifest: DataManifest;
  bucket: BucketIndex;
  budget: number;
  createShareUrl: () => string;
  showMap: () => void;
}

export default function WalkDetails({
  route,
  manifest,
  bucket,
  budget,
  createShareUrl,
  showMap,
}: Props) {
  const [shareUrl, setShareUrl] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const native = isNativePlatform();
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  const context = { manifest, bucket, maxExtraMinutes: budget };
  const filename = `brisa-${manifest.datasetId}-${route.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;

  async function saveFile(contents: string, name: string, mime: string) {
    setWorking(true);
    setMessage('');
    try {
      await exportFile(contents, name, mime);
    } catch {
      setMessage('Could not export this file. Try again.');
    } finally {
      setWorking(false);
    }
  }
  async function systemShare() {
    setWorking(true);
    setMessage('');
    try {
      await shareText(exportRouteText(route, context), shareUrl || undefined);
    } catch {
      setMessage(
        'Sharing was cancelled or unavailable. Your walking plan is unchanged.',
      );
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="walk-details" aria-label="Selected walk details">
      <div className="walk-details-title">
        <div>
          <span className="eyebrow">YOUR SELECTED WALK</span>
          <h3>Selected route</h3>
        </div>
        <button className="quiet-button" onClick={showMap}>
          <Map size={15} /> View map
        </button>
      </div>
      <details className="walk-more">
        <summary>Route details</summary>
        <details className="street-sequence">
          <summary>
            <Route size={17} />
            <span>Street sequence</span>
            <small>{route.segments.length} segments</small>
          </summary>
          <p>
            Follow the street order below. This is a planning reference;
            crossings, access and turn instructions are not verified.
          </p>
          <ol tabIndex={0} aria-label="Street sequence segments">
            {route.segments.map((segment, index) => (
              <li key={index}>
                <span>{segment.name || 'Unnamed walking path'}</span>
                <small>
                  {Math.round(segment.meters)} m · {segment.minutes.toFixed(1)}{' '}
                  min
                </small>
              </li>
            ))}
          </ol>
        </details>
        <div className="time-insight">
          <h3>Same walk, different windows</h3>
          <p>The historical index along this exact path.</p>
          <table className="time-profile">
            <caption className="sr-only">
              Historical exposure in index-minutes. Selected window:{' '}
              {manifest.timeBuckets[bucket]}.
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Local time window</th>
                <th scope="col">Relative index</th>
                <th scope="col">Index-minutes</th>
              </tr>
            </thead>
            <tbody>
              {manifest.timeBuckets.map((label, index) => (
                <tr key={label} data-selected={index === bucket}>
                  <th scope="row">{label}</th>
                  <td>
                    <span className="profile-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.max(0, Math.min(100, (route.exposureByBucket[index] / route.minutes) * 100))}%`,
                        }}
                      />
                    </span>
                  </td>
                  <td>
                    <output>{route.exposureByBucket[index].toFixed(2)}</output>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="insight-note">
            Index-minutes · {manifest.timezone}. Geometry stays fixed; this is
            historical context, not a forecast.
          </p>
        </div>
      </details>
      <div className="trip-actions">
        <button
          className="share-button"
          onClick={() => {
            setMessage('');
            setCopied(false);
            try {
              setShareUrl(getShareableTripUrl(createShareUrl()) ?? '');
              setShareOpen(true);
            } catch {
              setMessage(
                'Could not prepare the trip link. Try exporting the summary.',
              );
            }
          }}
        >
          <Share2 size={16} /> Share trip
        </button>
        <button
          className="quiet-button"
          disabled={working}
          onClick={() =>
            saveFile(
              exportRouteGpx(route, context),
              `${filename}.gpx`,
              'application/gpx+xml',
            )
          }
        >
          <Download size={15} /> {native ? 'Export GPX' : 'Download GPX'}
        </button>
        <button
          className="quiet-button summary-download"
          disabled={working}
          onClick={() =>
            saveFile(
              exportRouteText(route, context),
              `${filename}.txt`,
              'text/plain;charset=utf-8',
            )
          }
        >
          {native ? 'Export summary' : 'Download summary'}
        </button>
      </div>
      {shareOpen && (
        <div className="share-panel">
          {shareUrl ? (
            <>
              <label htmlFor="share-link">Shareable trip link</label>
              <p>
                This link includes both locations. Anyone you give it to can
                open this trip. Routes are recalculated from the available
                snapshot.
              </p>
              <input
                id="share-link"
                ref={linkInput}
                value={shareUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button
                className="quiet-button"
                onClick={async () => {
                  try {
                    await copyText(shareUrl);
                    setCopied(true);
                    setMessage('Link copied.');
                  } catch {
                    linkInput.current?.focus();
                    linkInput.current?.select();
                    setMessage('Select and copy the link above.');
                  }
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </>
          ) : (
            <p>
              No public trip-link address is configured for this app. You can
              share the route summary or export its geometry instead; these
              include the selected walking path and its historical context.
            </p>
          )}
          {native && (
            <button
              className="quiet-button"
              disabled={working}
              onClick={systemShare}
            >
              <Share2 size={15} />{' '}
              {shareUrl ? 'Open share sheet' : 'Share route summary'}
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
