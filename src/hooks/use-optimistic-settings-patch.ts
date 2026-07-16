"use client";

import * as React from "react";

import { updateSettingsPatchAction } from "@/app/settings/actions";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type { AppSettings } from "@/types";

type ErrorMessage = {
  title: string;
  description: string;
};

export function useOptimisticSettingsPatch<T>(args: {
  canMutate: boolean;
  createPatch: (value: T) => Partial<AppSettings>;
  serverValue: T;
  unexpectedError: ErrorMessage;
}) {
  const { toast } = useToast();
  const [value, setValue] = React.useState(args.serverValue);
  const [isSaving, startSavingTransition] = React.useTransition();
  const revisionRef = React.useRef(0);

  React.useEffect(() => {
    revisionRef.current += 1;
    setValue(args.serverValue);
  }, [args.serverValue]);

  const update = React.useCallback(
    (nextValue: T) => {
      const previousValue = value;
      setValue(nextValue);

      if (!args.canMutate) return;

      const revision = ++revisionRef.current;
      startSavingTransition(async () => {
        try {
          const result = await updateSettingsPatchAction(
            args.createPatch(nextValue),
          );
          if (revision !== revisionRef.current || result.success) return;

          setValue(previousValue);
          toast({
            title: result.message.title,
            description: result.message.description,
            variant: "destructive",
          });
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) return;
          if (revision !== revisionRef.current) return;

          setValue(previousValue);
          toast({
            title: args.unexpectedError.title,
            description: args.unexpectedError.description,
            variant: "destructive",
          });
        }
      });
    },
    [args, toast, value],
  );

  return { isSaving, update, value };
}
