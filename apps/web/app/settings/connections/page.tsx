import type { Metadata } from "next";

import { CustomConnectionsFlow } from "@/src/components/custom-connections/custom-connections-flow";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { requireCustomConnectionsPageAccess } from "@/src/lib/custom-connections/access";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Your services — Murph",
    description: "Services Murph can look things up in.",
  }),
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

function readParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
}

/** Services the member connects so Murph can look things up in them. Only for members on the rollout list. */
export default async function CustomConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCustomConnectionsPageAccess();
  const params = await searchParams;
  return (
    <LinkPageFrame fit>
      <CustomConnectionsFlow
        returned={{
          connectionId: readParam(params.connection),
          error: readParam(params.error),
          step: readParam(params.step),
        }}
      />
    </LinkPageFrame>
  );
}
