import type * as React from "react";

export type CodebergIconProps = React.SVGProps<SVGSVGElement>;

export function CodebergIcon({ className, ...props }: CodebergIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M7 17.5 12 7.8l5 9.7" />
      <path d="M13.5 10.6 17 17.5" />
    </svg>
  );
}
