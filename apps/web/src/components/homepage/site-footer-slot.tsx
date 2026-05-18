"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Routes that are full-viewport experiences and own their own scroll
// container — the marketing footer would sit outside that container and
// break snap scrolling, so it is suppressed here.
const FOOTERLESS_ROUTES = new Set<string>(["/pitch"]);

export function SiteFooterSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname && FOOTERLESS_ROUTES.has(pathname)) {
    return null;
  }
  return <>{children}</>;
}
