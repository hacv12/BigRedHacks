import { useSyncExternalStore } from 'react';
import {
  applyAppUpdate,
  getInstallState,
  installApp,
  subscribeInstall,
} from '../pwa/register';
import './app-install.css';
export default function AppInstall() {
  const state = useSyncExternalStore(
    subscribeInstall,
    getInstallState,
    getInstallState,
  );
  if (!state.available) return null;
  return (
    <details className="app-install">
      <summary>
        {state.installed ? 'Installed app & offline access' : 'Install Brisa'}
      </summary>
      {state.canInstall && (
        <button
          type="button"
          onClick={() => {
            void installApp();
          }}
        >
          Install app
        </button>
      )}
      {!state.installed && !state.canInstall && (
        <p>
          On iPhone or iPad, open in Safari, choose Share, then Add to Home
          Screen. Other browsers may offer Install app in their menu.
        </p>
      )}
      <p>
        {state.offlineReady
          ? `App saved offline · ${state.cachedAreas.length} visited area${state.cachedAreas.length === 1 ? '' : 's'} saved.`
          : 'Preparing offline app files…'}
      </p>
      <p>
        Only areas you open are saved. Tiles, address search and latest activity
        need internet. Browser storage may be cleared; reopen your area online
        before relying on it offline.
      </p>
      {state.updateAvailable && (
        <div role="status">
          <p>
            An app update is ready. Updating reloads this screen; save a share
            link first if you want to keep this trip.
          </p>
          <button type="button" onClick={applyAppUpdate}>
            Update and reload app
          </button>
        </div>
      )}
      {state.error && <p role="status">Offline storage: {state.error}</p>}
    </details>
  );
}
