import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useIsDark } from '../src/lib/theme';

type Listener = () => void;
let prefersDark = false;
let listeners: Listener[] = [];

beforeEach(() => {
  prefersDark = false;
  listeners = [];
  delete document.documentElement.dataset.theme;
  window.matchMedia = ((q: string) => ({
    get matches() { return prefersDark; },
    media: q,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => { listeners = listeners.filter((x) => x !== l); },
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { delete document.documentElement.dataset.theme; });

describe('useIsDark', () => {
  it('follows the OS preference live', () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);
    act(() => { prefersDark = true; listeners.forEach((l) => l()); });
    expect(result.current).toBe(true);
  });

  it('follows data-theme changes live and the attribute wins over the OS', async () => {
    prefersDark = true;
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(true);
    await act(async () => { document.documentElement.dataset.theme = 'light'; await Promise.resolve(); });
    expect(result.current).toBe(false);
    await act(async () => { document.documentElement.dataset.theme = 'dark'; await Promise.resolve(); });
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useIsDark());
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });
});
