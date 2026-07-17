import type { ReactNode } from "react";

import {
  MurphSafeFooter,
  MurphSafeHeader,
} from "@/src/components/murph-safe/murph-safe-shell";

export default function MurphSafeLayout(input: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MurphSafeHeader />
      <div className="flex-1">{input.children}</div>
      <MurphSafeFooter />
    </div>
  );
}
