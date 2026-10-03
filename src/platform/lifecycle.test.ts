import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  native: true,
  add: vi.fn(),
  state: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('./native', () => ({ isNativePlatform: () => mocks.native }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.add, getState: mocks.state },
}));
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.native = true;
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  );
  vi.stubGlobal('window', new EventTarget());
  mocks.add.mockResolvedValue({ remove: mocks.remove });
  mocks.remove.mockResolvedValue(undefined);
  mocks.state.mockResolvedValue({ isActive: true });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});
describe('native visibility bridge', () => {
  it('web follows document visibility without invoking native plugins', async () => {
    mocks.native = false;
    const api = await import('./lifecycle');
    cleanup = api.initNativeLifecycle();
    expect(api.isAppVisible()).toBe(true);
    Object.assign(document, { visibilityState: 'hidden' });
    expect(api.isAppVisible()).toBe(false);
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('native background pauses visibility even when document stays visible and foreground resumes', async () => {
    const api = await import('./lifecycle');
    const changed = vi.fn();
    document.addEventListener(api.APP_VISIBILITY_EVENT, changed);
    expect(api.isAppVisible()).toBe(false);
    cleanup = api.initNativeLifecycle();
    await vi.waitFor(() => expect(api.isAppVisible()).toBe(true));
    expect(mocks.add).toHaveBeenCalledWith(
      'appStateChange',
      expect.any(Function),
    );
    const callback = mocks.add.mock.calls[0][1];
    callback({ isActive: false });
    expect(document.visibilityState).toBe('visible');
    expect(api.isAppVisible()).toBe(false);
    callback({ isActive: true });
    expect(api.isAppVisible()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(3);
    Object.assign(document, { visibilityState: 'hidden' });
    expect(api.isAppVisible()).toBe(false);
  });
  it('does not let a late initial state overwrite a newer background event', async () => {
    let finish!: (state: { isActive: boolean }) => void;
    mocks.state.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const api = await import('./lifecycle');
    cleanup = api.initNativeLifecycle();
    await vi.waitFor(() => expect(mocks.state).toHaveBeenCalled());
    mocks.add.mock.calls[0][1]({ isActive: false });
    finish({ isActive: true });
    await Promise.resolve();
    expect(api.isAppVisible()).toBe(false);
  });
  it('removes a listener even when cleanup precedes asynchronous registration and initializes only once', async () => {
    let finish!: (handle: { remove: typeof mocks.remove }) => void;
    mocks.add.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const api = await import('./lifecycle');
    cleanup = api.initNativeLifecycle();
    api.initNativeLifecycle();
    await vi.waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    cleanup();
    finish({ remove: mocks.remove });
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it('surfaces initialization failure rather than silently polling in background', async () => {
    mocks.add.mockRejectedValueOnce(new Error('bridge'));
    const error = vi.fn();
    window.addEventListener('brisa:platformerror', error);
    const api = await import('./lifecycle');
    cleanup = api.initNativeLifecycle();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(api.isAppVisible()).toBe(false);
  });
});
