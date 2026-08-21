import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { migrateAuthAccountIdentities } from "@/lib/auth/account-identity-migration";
import {
  getBetterAuthConfig,
  getSetupBetterAuthConfig,
} from "@/lib/auth/better-auth-config";
import { logger } from "@/lib/logger";

const log = logger.withScope("Auth");

function createAuthInstance() {
  return betterAuth(getBetterAuthConfig());
}

function createSetupAuthInstance() {
  return betterAuth(getSetupBetterAuthConfig());
}

type AuthInstance = ReturnType<typeof createAuthInstance>;
let authInstance: AuthInstance | null = null;
let setupAuthInstance: AuthInstance | null = null;

function createLazyAuth(getInstance: () => AuthInstance): AuthInstance {
  return new Proxy({} as AuthInstance, {
    get(_target, property) {
      const instance = getInstance();
      return Reflect.get(instance, property, instance);
    },
    set(_target, property, value) {
      const instance = getInstance();
      return Reflect.set(instance, property, value, instance);
    },
    has(_target, property) {
      return property in getInstance();
    },
    ownKeys() {
      return Reflect.ownKeys(getInstance());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        getInstance(),
        property,
      );
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const auth = createLazyAuth(() => {
  authInstance ??= createAuthInstance();
  return authInstance;
});

export const setupAuth = createLazyAuth(() => {
  setupAuthInstance ??= createSetupAuthInstance();
  return setupAuthInstance;
});

let authDatabaseReadyPromise: Promise<void> | null = null;

export async function ensureAuthDatabaseReady() {
  if (authDatabaseReadyPromise) {
    log.debug(
      "Auth database readiness already initialized; reusing existing promise.",
    );
    return authDatabaseReadyPromise;
  }

  authDatabaseReadyPromise = (async () => {
    log.info("Checking Better Auth database migrations.");
    if (migrateAuthAccountIdentities()) {
      log.info("Migrated Better Auth account identities for version 1.7.");
    }
    const migrations = await getMigrations(getBetterAuthConfig());
    if (migrations.toBeCreated.length > 0 || migrations.toBeAdded.length > 0) {
      log.info(
        `Applying Better Auth migrations (create=${migrations.toBeCreated.length}, add=${migrations.toBeAdded.length}).`,
      );
    } else {
      log.debug(
        "Better Auth schema already up to date (no migrations needed).",
      );
    }
    await migrations.runMigrations();
    log.info("Better Auth migration check completed.");
  })().catch((error) => {
    authDatabaseReadyPromise = null;
    log.error("Better Auth migration check failed.", error);
    throw error;
  });

  return authDatabaseReadyPromise;
}
