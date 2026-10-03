import type { CityDataset } from '../domain/types';
export interface AppInstallState {
  available: boolean;
  installed: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  offlineReady: boolean;
  cachedAreas: string[];
  error: string;
}
const disabled = import.meta.env.DEV || import.meta.env.VITE_NATIVE === '1';
let state: AppInstallState = {
  available:
    !disabled &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator,
  installed: false,
  canInstall: false,
  updateAvailable: false,
  offlineReady: false,
  cachedAreas: [],
  error: '',
};
const listeners = new Set<() => void>();
export const subscribeInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getInstallState = () => state;
function update(patch: Partial<AppInstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let prompt: InstallPrompt | undefined;
let registration: ServiceWorkerRegistration | undefined;
let started = false;
function message(
  worker: ServiceWorker,
  payload: unknown,
): Promise<{ ok: boolean; cities?: string[]; error?: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('Offline storage did not respond.'));
    }, 30000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage(payload, [channel.port2]);
  });
}
function ready(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(
          new Error('Offline app setup timed out. Try again while connected.'),
        ),
      45000,
    );
    navigator.serviceWorker.ready.then(
      (reg) => {
        clearTimeout(timeout);
        resolve(reg);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
async function refreshStatus() {
  const active = registration?.active;
  if (!active) return;
  const result = await message(active, { type: 'CACHE_STATUS' });
  if (result.ok)
    update({ offlineReady: true, cachedAreas: result.cities ?? [] });
}
export function registerPwa(): void {
  if (started || !state.available) return;
  started = true;
  update({
    installed:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    update({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    prompt = undefined;
    update({ installed: true, canInstall: false });
  });
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    })
    .then((reg) => {
      registration = reg;
      update({ updateAvailable: !!reg.waiting });
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed')
            update({
              updateAvailable:
                !!reg.waiting && !!navigator.serviceWorker.controller,
            });
        });
      });
      return ready();
    })
    .then(() => refreshStatus())
    .catch((error) =>
      update({
        error:
          error instanceof Error ? error.message : 'Offline app setup failed.',
      }),
    );
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    void refreshStatus().catch(() => {});
  });
}
/** Save the already loaded validated dataset, avoiding a duplicate download on first visit. */
export async function cacheLoadedDataset(
  packageUrl: string,
  data: CityDataset,
): Promise<boolean> {
  if (!state.available) return false;
  registerPwa();
  try {
    const path = `${import.meta.env.BASE_URL}${packageUrl.replace(/^\//, '')}`;
    if (
      !/^\/?data\/[a-zA-Z0-9_-]+\.json$/.test(packageUrl) ||
      data.manifest.datasetId === ''
    )
      return false;
    const reg = await ready();
    if (!reg.active) return false;
    registration ??= reg;
    const result = await message(reg.active, {
      type: 'CACHE_CITY',
      path,
      data,
    });
    if (!result.ok)
      throw new Error(result.error || 'This area could not be saved offline.');
    await refreshStatus();
    return true;
  } catch (error) {
    update({
      error:
        error instanceof Error
          ? error.message
          : 'Offline storage is unavailable.',
    });
    return false;
  }
}
export async function installApp() {
  if (!prompt) return;
  const current = prompt;
  prompt = undefined;
  try {
    await current.prompt();
    await current.userChoice;
  } catch {
    update({
      error:
        'Installation was not completed. Use your browser menu to try again.',
    });
  } finally {
    update({ canInstall: false });
  }
}
export function applyAppUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return;
  // Reload only after this explicit action, never merely because an update exists.
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => window.location.reload(),
    { once: true },
  );
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
