import type { PluginListenerHandle } from '@capacitor/core';
import { isNativePlatform } from './native';

export const APP_VISIBILITY_EVENT = 'brisa:visibilitychange';
let nativeActive = false;
let initialized = false;
/** Native activity and browser visibility both matter: WebViews can stay document-visible in background. */
export function isAppVisible(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    (!isNativePlatform() || nativeActive)
  );
}
function changed() {
  document.dispatchEvent(new Event(APP_VISIBILITY_EVENT));
}
function reportError() {
  window.dispatchEvent(
    new CustomEvent('brisa:platformerror', {
      detail:
        'App activity state is unavailable. Automatic updates are paused until the app becomes active again.',
    }),
  );
}
/** Initialize once before React renders. Cleanup is safe even before the native listener resolves. */
export function initNativeLifecycle(): () => void {
  if (!isNativePlatform() || initialized) return () => {};
  initialized = true;
  nativeActive = false;
  let disposed = false,
    revision = 0;
  let handle: PluginListenerHandle | undefined;
  void import('@capacitor/app')
    .then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', (state) => {
        if (disposed) return;
        revision += 1;
        nativeActive = state.isActive;
        changed();
      });
      if (disposed) {
        await listener.remove();
        return;
      }
      handle = listener;
      const before = revision;
      const state = await App.getState();
      if (!disposed && before === revision) {
        nativeActive = state.isActive;
        changed();
      }
    })
    .catch(() => {
      if (!disposed) reportError();
    });
  return () => {
    if (disposed) return;
    disposed = true;
    initialized = false;
    nativeActive = false;
    if (handle) void handle.remove().catch(reportError);
    changed();
  };
}
