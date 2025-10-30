// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reloadIfServerActionStale } from '@/lib/server-action-error';

const ORIGINAL_WINDOW = globalThis.window;

afterEach(() => {
  if (ORIGINAL_WINDOW === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = ORIGINAL_WINDOW;
  }
});

describe('reloadIfServerActionStale', () => {
  it('reloads the page and returns true when message contains stale server action text', () => {
    const reloadSpy = vi.fn();
    (globalThis as any).window = { location: { reload: reloadSpy } };

    const result = reloadIfServerActionStale(
      new Error('Failed to find Server Action "abc"'),
    );

    expect(result).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false and does not reload for other errors', () => {
    const reloadSpy = vi.fn();
    (globalThis as any).window = { location: { reload: reloadSpy } };

    const result = reloadIfServerActionStale(new Error('Other error'));

    expect(result).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('returns false when window is not defined', () => {
    delete (globalThis as any).window;
    const result = reloadIfServerActionStale(
      new Error('Failed to find Server Action "abc"'),
    );

    expect(result).toBe(false);
  });
});
