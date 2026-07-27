import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, dir, inputMode, type, ...props }, ref) => {
    const technicalDirection =
      type === "email" ||
      type === "number" ||
      type === "password" ||
      type === "tel" ||
      type === "url" ||
      inputMode === "decimal" ||
      inputMode === "email" ||
      inputMode === "numeric" ||
      inputMode === "tel" ||
      inputMode === "url"
        ? "ltr"
        : undefined;

    return (
      <input
        type={type}
        dir={dir ?? technicalDirection ?? "auto"}
        inputMode={inputMode}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
