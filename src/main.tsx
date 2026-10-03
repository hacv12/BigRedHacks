import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerPwa } from './pwa/register';
import { initNativeLifecycle } from './platform/lifecycle';
import { isNativePlatform, openExternalUrl } from './platform/native';

const disposeNative = initNativeLifecycle();
registerPwa();
function openNativeLink(event: MouseEvent) {
  if (!isNativePlatform() || event.defaultPrevented || event.button !== 0)
    return;
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>(
    'a[href]',
  );
  if (!anchor || anchor.download || !anchor.href.startsWith('https:')) return;
  const url = new URL(anchor.href);
  if (url.origin === window.location.origin) return;
  event.preventDefault();
  void openExternalUrl(url.toString()).catch(() => {
    window.dispatchEvent(
      new CustomEvent('brisa:platformerror', {
        detail:
          'Could not open this link. Check your connection and try again.',
      }),
    );
  });
}
document.addEventListener('click', openNativeLink);
import.meta.hot?.dispose(() => {
  disposeNative();
  document.removeEventListener('click', openNativeLink);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
