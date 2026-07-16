export type LoginAttemptState = {
  failures: number;
  firstFailedAt: number;
  lastFailedAt: number;
  lockedUntil: number;
};

export const MAX_LOGIN_RATE_LIMIT_ENTRIES = 10_000;
export const MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES = 1_024;

declare global {
  var _authLoginAttempts: Map<string, LoginAttemptState> | undefined;
  var _authLoginOverflowAttempts: Map<string, LoginAttemptState> | undefined;
}

global._authLoginAttempts ??= new Map<string, LoginAttemptState>();
global._authLoginOverflowAttempts ??= new Map<string, LoginAttemptState>();

class LoginRateLimitStore {
  private readonly primary = global._authLoginAttempts as Map<
    string,
    LoginAttemptState
  >;
  private readonly overflow = global._authLoginOverflowAttempts as Map<
    string,
    LoginAttemptState
  >;
  private lastPruneAt: number | null = null;

  get(key: string): LoginAttemptState | undefined {
    return this.primary.get(key) ?? this.overflow.get(key);
  }

  set(key: string, state: LoginAttemptState): void {
    if (this.primary.delete(key)) {
      this.primary.set(key, state);
      return;
    }
    if (this.overflow.delete(key)) {
      this.overflow.set(key, state);
      return;
    }

    if (this.primary.size >= MAX_LOGIN_RATE_LIMIT_ENTRIES) {
      const evictableKey = this.primary
        .entries()
        .find(
          ([, candidate]) => candidate.lockedUntil <= state.lastFailedAt,
        )?.[0];
      if (evictableKey !== undefined) {
        this.primary.delete(evictableKey);
      } else {
        if (this.overflow.size >= MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES) {
          const oldestOverflowKey = this.overflow.keys().next().value;
          if (oldestOverflowKey !== undefined) {
            this.overflow.delete(oldestOverflowKey);
          }
        }
        this.overflow.set(key, state);
        return;
      }
    }
    this.primary.set(key, state);
  }

  delete(key: string): void {
    this.primary.delete(key);
    this.overflow.delete(key);
  }

  prune(now: number, windowMs: number, intervalMs: number): void {
    if (
      this.lastPruneAt !== null &&
      now >= this.lastPruneAt &&
      now - this.lastPruneAt < intervalMs
    ) {
      return;
    }
    this.lastPruneAt = now;
    this.pruneMap(this.primary, now, windowMs);
    this.pruneMap(this.overflow, now, windowMs);
  }

  private pruneMap(
    store: Map<string, LoginAttemptState>,
    now: number,
    windowMs: number,
  ): void {
    for (const [key, state] of store.entries()) {
      if (state.lockedUntil > now) continue;
      if (now - state.lastFailedAt > windowMs) store.delete(key);
    }
  }
}

export const loginRateLimitStore = new LoginRateLimitStore();
