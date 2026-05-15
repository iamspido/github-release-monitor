import type * as React from "react";
import { siCodeberg } from "simple-icons";

export type SimpleBrandIconProps = React.SVGProps<SVGSVGElement>;

function OutlineBrandIcon({ children, ...props }: SimpleBrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GithubBrandIcon(props: SimpleBrandIconProps) {
  return (
    <OutlineBrandIcon {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </OutlineBrandIcon>
  );
}

export function GitlabBrandIcon(props: SimpleBrandIconProps) {
  return (
    <OutlineBrandIcon {...props}>
      <path d="m22 13.29-3.33-10a.42.42 0 0 0-.14-.18.38.38 0 0 0-.22-.08.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18l-2.26 6.67H8.32L6.1 3.26a.42.42 0 0 0-.14-.18.38.38 0 0 0-.22-.08.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18L2 13.29a.74.74 0 0 0 .27.83L12 21l9.69-6.88a.74.74 0 0 0 .31-.83Z" />
    </OutlineBrandIcon>
  );
}

export function CodebergBrandIcon(props: SimpleBrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d={siCodeberg.path} />
    </svg>
  );
}
