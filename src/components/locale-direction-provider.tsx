"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import type { ReactNode } from "react";
import type { LocaleDirection } from "@/i18n/config";

export function LocaleDirectionProvider({
  children,
  direction,
}: {
  children: ReactNode;
  direction: LocaleDirection;
}) {
  return <DirectionProvider dir={direction}>{children}</DirectionProvider>;
}
