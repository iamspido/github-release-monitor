"use client";

import * as React from "react";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

export function useActionTransition() {
  const [isPending, startTransition] = React.useTransition();

  const runAction = React.useCallback(
    (action: () => Promise<void>, onError?: (error: unknown) => void): void => {
      startTransition(async () => {
        try {
          await action();
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) {
            return;
          }
          onError?.(error);
        }
      });
    },
    [],
  );

  return { isPending, runAction };
}
