"use client";

import * as React from "react";
import { checkSetupRequired } from "@/lib/auth/client-flow-utils";

export function useSetupRequirement() {
  const [setupRequired, setSetupRequired] = React.useState(false);
  const [setupLoading, setSetupLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const required = await checkSetupRequired();
        if (active) setSetupRequired(required);
      } finally {
        if (active) setSetupLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return { setupLoading, setupRequired, setSetupRequired };
}
