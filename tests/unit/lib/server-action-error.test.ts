// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isStaleServerActionError,
  reloadIfServerActionStale,
} from '@/lib/server-action-error';

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

  it('reloads the page when Next 15 reports an unrecognized server action', () => {
    const reloadSpy = vi.fn();
    (globalThis as any).window = { location: { reload: reloadSpy } };

    const result = reloadIfServerActionStale(
      new Error(
        'UnrecognizedActionError: Server Action "abc" was not found on the server.',
      ),
    );

    expect(result).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads the page when the error digest marks the action as undefined', () => {
    const reloadSpy = vi.fn();
    (globalThis as any).window = { location: { reload: reloadSpy } };
    const error = new Error('Some error');
    (error as any).digest = 'NEXT_UNDEFINED_ACTION_123';

    const result = reloadIfServerActionStale(error);

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

describe('isStaleServerActionError', () => {
  it('detects stale server action error by message', () => {
    expect(
      isStaleServerActionError(
        new Error('Failed to find Server Action "abc"'),
      ),
    ).toBe(true);
  });

  it('detects stale server action error by digest', () => {
    const error = new Error('Some error');
    (error as any).digest = 'NEXT_UNDEFINED_ACTION_XYZ';
    expect(isStaleServerActionError(error)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isStaleServerActionError(new Error('Other error'))).toBe(false);
  });
});
