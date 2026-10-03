import { Capacitor } from '@capacitor/core';

export const isNativePlatform = () => Capacitor.isNativePlatform();
export const canLocate = () =>
  isNativePlatform() ||
  (typeof navigator !== 'undefined' && !!navigator.geolocation);
export interface CurrentPosition {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
}
export interface LocationFailure {
  code: number;
  message: string;
}
/** Called only by an explicit location action; never starts a watcher or background tracking. */
export function requestCurrentPosition(
  success: (position: CurrentPosition) => void,
  failure: (error: LocationFailure) => void,
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 60_000,
  },
): void {
  if (!isNativePlatform()) {
    if (!canLocate()) {
      failure({ code: 2, message: 'Location is unavailable.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(success, failure, options);
    return;
  }
  void import('@capacitor/geolocation')
    .then(({ Geolocation }) => Geolocation.getCurrentPosition(options))
    .then(success)
    .catch((error) => {
      const code = String(error?.code ?? '');
      failure({
        code:
          code === 'OS-PLUG-GLOC-0003'
            ? 1
            : code === 'OS-PLUG-GLOC-0010'
              ? 3
              : 2,
        message:
          code === 'OS-PLUG-GLOC-0003'
            ? 'Location permission was declined.'
            : 'Could not get your location.',
      });
    });
}

/** Never publish the app WebView's localhost origin as a share link. */
export function resolvePublicTripUrl(
  generated: string,
  configured: string | undefined,
): string | null {
  if (!configured?.trim()) return null;
  try {
    const base = new URL(configured);
    const host = base.hostname.toLowerCase();
    const local =
      !host.includes('.') ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.includes(':') ||
      /^(0|10|127)\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (
      base.protocol !== 'https:' ||
      local ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return null;
    const trip = new URL(generated);
    base.search = trip.search;
    base.hash = trip.hash;
    return base.toString();
  } catch {
    return null;
  }
}
/** Internal input for the HTTP-only trip encoder; native output still MUST pass getShareableTripUrl. */
export function tripEncodingBase(currentUrl: string): string {
  if (!isNativePlatform()) return currentUrl;
  return (
    resolvePublicTripUrl(
      'https://localhost/',
      import.meta.env.VITE_PUBLIC_APP_URL,
    ) ?? 'https://localhost/'
  );
}
export function getShareableTripUrl(generated: string): string | null {
  return isNativePlatform()
    ? resolvePublicTripUrl(generated, import.meta.env.VITE_PUBLIC_APP_URL)
    : generated;
}
export async function copyText(text: string): Promise<void> {
  if (isNativePlatform()) {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
  } else await navigator.clipboard.writeText(text);
}
export async function shareText(text: string, url?: string): Promise<void> {
  if (url && !resolvePublicTripUrl(url, new URL(url).origin))
    throw new Error('A public HTTPS link is required.');
  const { Share } = await import('@capacitor/share');
  await Share.share({
    title: 'Brisa walking plan',
    text,
    ...(url ? { url } : {}),
    dialogTitle: 'Share walking plan',
  });
}
export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Only HTTPS external links can be opened.');
  if (isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: url.toString() });
  } else window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

const EXPORT_DIR = 'brisa-exports';
/** Deletes only this helper's own old cache exports, leaving unrelated app files untouched. */
export async function exportFile(
  contents: string,
  filename: string,
  mime: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(filename) || filename.startsWith('.'))
    throw new Error('Invalid export filename.');
  if (!isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const { Filesystem, Directory, Encoding } =
    await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  // Cache-only files are shareable under Capacitor's default Android FileProvider configuration.
  try {
    const { files } = await Filesystem.readdir({
      path: EXPORT_DIR,
      directory: Directory.Cache,
    });
    const owned = files
      .filter(
        (file) =>
          file.type === 'file' &&
          /^\d{13}-[a-z0-9]+-brisa-[a-zA-Z0-9_.-]+$/.test(file.name),
      )
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const file of owned.filter(
      (file, index) =>
        index >= 9 ||
        Number(file.name.slice(0, 13)) < Date.now() - 7 * 86400_000,
    )) {
      await Filesystem.deleteFile({
        path: `${EXPORT_DIR}/${file.name}`,
        directory: Directory.Cache,
      });
    }
  } catch {
    /* Missing/OS-cleaned cache is normal; export remains available. */
  }
  const safeName = filename.startsWith('brisa-')
    ? filename
    : `brisa-${filename}`;
  const path = `${EXPORT_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
  const { uri } = await Filesystem.writeFile({
    path,
    data: contents,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await Share.share({
    title: filename,
    files: [uri],
    dialogTitle: 'Export walking plan',
  });
}
