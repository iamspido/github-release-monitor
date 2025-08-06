import { ReactNode } from 'react';

// This layout is required by Next.js.
// We return children directly to avoid nested <html> and <body> tags,
// which are handled by the [locale] layout to set the `lang` attribute correctly.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
