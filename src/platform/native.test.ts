import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  native: true,
  position: vi.fn(),
  clipboard: vi.fn(),
  share: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: { getCurrentPosition: mocks.position },
}));
vi.mock('@capacitor/clipboard', () => ({
  Clipboard: { write: mocks.clipboard },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir: mocks.read,
    writeFile: mocks.write,
    deleteFile: mocks.remove,
  },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));
import {
  canLocate,
  copyText,
  exportFile,
  getShareableTripUrl,
  openExternalUrl,
  requestCurrentPosition,
  resolvePublicTripUrl,
  shareText,
  tripEncodingBase,
} from './native';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = true;
  vi.unstubAllEnvs();
  mocks.read.mockResolvedValue({ files: [] });
  mocks.write.mockResolvedValue({ uri: 'file:///cache/brisa-test.gpx' });
  mocks.share.mockResolvedValue({});
  mocks.remove.mockResolvedValue(undefined);
});
describe('native platform boundaries', () => {
  it('rebases only trip query/hash onto explicitly configured public HTTPS app path', () => {
    const result = resolvePublicTripUrl(
      'capacitor://localhost/?area=nyc&trip=abc#test',
      'https://example.com/Brisa/',
    );
    expect(result).toBe('https://example.com/Brisa/?area=nyc&trip=abc#test');
    expect(getShareableTripUrl('https://localhost/?trip=abc')).toBeNull();
    expect(tripEncodingBase('capacitor://localhost/')).toBe(
      'https://localhost/',
    );
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://example.com/Brisa/');
    expect(tripEncodingBase('capacitor://localhost/')).toBe(
      'https://example.com/Brisa/',
    );
    expect(getShareableTripUrl('https://localhost/?trip=abc')).toBe(
      'https://example.com/Brisa/?trip=abc',
    );
    mocks.native = false;
    expect(getShareableTripUrl('http://localhost:5173/?trip=abc')).toBe(
      'http://localhost:5173/?trip=abc',
    );
  });
  it.each([
    undefined,
    'http://example.com',
    'https://localhost',
    'https://foo.localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://192.168.1.1',
    'https://172.16.0.1',
    'https://[::1]',
    'capacitor://localhost',
    'https://user:pass@example.com',
    'https://example.com/?token=x',
  ])('does not generate a broken/private native link for %s', (value) => {
    expect(
      resolvePublicTripUrl('capacitor://localhost/?trip=a', value),
    ).toBeNull();
  });
  it('uses one native position request only when called and maps permission denial', async () => {
    expect(canLocate()).toBe(true);
    expect(mocks.position).not.toHaveBeenCalled();
    const position = {
      coords: { longitude: -74, latitude: 40.75, accuracy: 20 },
      timestamp: 1,
    };
    mocks.position.mockResolvedValueOnce(position);
    const success = vi.fn(),
      failure = vi.fn();
    requestCurrentPosition(success, failure);
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith(position));
    expect(mocks.position).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    });
    mocks.position.mockRejectedValueOnce({ code: 'OS-PLUG-GLOC-0003' });
    requestCurrentPosition(success, failure);
    await vi.waitFor(() =>
      expect(failure).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1 }),
      ),
    );
  });
  it('uses native clipboard and system browser, rejecting executable link schemes', async () => {
    await copyText('trip');
    expect(mocks.clipboard).toHaveBeenCalledWith({ string: 'trip' });
    await openExternalUrl('https://example.com/source');
    expect(mocks.open).toHaveBeenCalledWith({
      url: 'https://example.com/source',
    });
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow(
      'HTTPS',
    );
  });
  it('shares summary without manufacturing a webview link', async () => {
    await shareText('Historical walking plan');
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Historical walking plan' }),
    );
    expect(mocks.share.mock.calls[0][0]).not.toHaveProperty('url');
    await expect(
      shareText('plan', 'https://localhost/?trip=x'),
    ).rejects.toThrow('public HTTPS');
  });
  it('writes exact export contents to cache before sharing its native URI and deletes only owned old exports', async () => {
    mocks.read.mockResolvedValueOnce({
      files: [
        { type: 'file', name: '1700000000000-old-brisa-trip.gpx' },
        { type: 'file', name: 'unrelated.txt' },
        { type: 'directory', name: '1700000000000-dir-brisa-data' },
      ],
    });
    await exportFile(
      '<gpx>exact geometry</gpx>',
      'brisa-trip.gpx',
      'application/gpx+xml',
    );
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        data: '<gpx>exact geometry</gpx>',
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
      }),
    );
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/brisa-test.gpx'] }),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0][0].path).toBe(
      'brisa-exports/1700000000000-old-brisa-trip.gpx',
    );
  });
  it('rejects unsafe filenames and never shares after failed writes', async () => {
    await expect(
      exportFile('x', '../private.txt', 'text/plain'),
    ).rejects.toThrow('filename');
    mocks.write.mockRejectedValueOnce(new Error('disk'));
    await expect(
      exportFile('x', 'brisa-trip.txt', 'text/plain'),
    ).rejects.toThrow('disk');
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
