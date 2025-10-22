import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('toast reducer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces toast limit when adding new toasts', async () => {
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        {
          id: '1',
          open: true,
        } as any,
      ],
    };
    const result = reducer(state, {
      type: 'ADD_TOAST',
      toast: {
        id: '2',
        open: true,
      } as any,
    });
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0].id).toBe('2');
  });

  it('merges updates into existing toast entries', async () => {
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        {
          id: '1',
          title: 'Old title',
          open: true,
        } as any,
      ],
    };
    const result = reducer(state, {
      type: 'UPDATE_TOAST',
      toast: {
        id: '1',
        title: 'Updated title',
      } as any,
    });
    expect(result.toasts[0].title).toBe('Updated title');
  });

  it('dismisses a single toast and schedules removal', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        {
          id: '1',
          open: true,
        } as any,
      ],
    };
    const result = reducer(state, {
      type: 'DISMISS_TOAST',
      toastId: '1',
    });
    expect(result.toasts[0].open).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(1_000_000);
    setTimeoutSpy.mockRestore();
  });

  it('dismisses all toasts when no id is provided', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        { id: '1', open: true } as any,
        { id: '2', open: true } as any,
      ],
    };
    const result = reducer(state, {
      type: 'DISMISS_TOAST',
    });
    expect(result.toasts.every(t => t.open === false)).toBe(true);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(1_000_000);
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(1_000_000);
    setTimeoutSpy.mockRestore();
  });

  it('removes a toast when requested', async () => {
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        { id: '1', open: true } as any,
        { id: '2', open: true } as any,
      ],
    };
    const result = reducer(state, {
      type: 'REMOVE_TOAST',
      toastId: '1',
    });
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0].id).toBe('2');
  });

  it('clears all toasts when remove has no id', async () => {
    const { reducer } = await import('@/hooks/use-toast');
    const state = {
      toasts: [
        { id: '1', open: true } as any,
        { id: '2', open: true } as any,
      ],
    };
    const result = reducer(state, {
      type: 'REMOVE_TOAST',
    });
    expect(result.toasts).toHaveLength(0);
  });

  it('creates toast helpers that can dismiss and update', async () => {
    vi.useFakeTimers();
    const { toast } = await import('@/hooks/use-toast');
    const instance = toast({ title: 'Hello' });
    expect(instance.id).toBeDefined();
    expect(typeof instance.dismiss).toBe('function');
    expect(typeof instance.update).toBe('function');
    expect(() => instance.update({ id: instance.id, title: 'Updated', open: true } as any)).not.toThrow();
    expect(() => instance.dismiss()).not.toThrow();
  });
});
