import type { Metadata } from "next";
import { Suspense } from "react";
import { DesignPage } from "./design-page";

export const metadata: Metadata = {
  title: "Murph — Design",
  description: "Brand guidelines, visual identity, and component library.",
};

export default function Page() {
  return (
    <Suspense>
      <DesignPage />
    </Suspense>
  );
}
