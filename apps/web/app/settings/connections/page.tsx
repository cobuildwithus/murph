import type { Metadata } from "next";

import { CustomConnectionsFlow } from "@/src/components/custom-connections/custom-connections-flow";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { LinkPageSignIn } from "@/src/components/link-page/link-page-sign-in";
import { readCustomConnectionsPageAccess } from "@/src/lib/custom-connections/access";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "MCP servers — Murph",
    description: "MCP servers Murph can look things up in.",
  }),
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

function readParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
}

/** An MCP link Murph sent, filled in for the member to check and continue. Nothing connects until they do. */
function readPrefilledLink(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** MCP servers any active member connects so Murph can look things up in them. */
export default async function CustomConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await readCustomConnectionsPageAccess() === "signed_out") {
    return <LinkPageSignIn detail="Then Murph can look things up in it for you." title="Sign in to add an MCP server." />;
  }
  const params = await searchParams;
  return (
    <LinkPageFrame fit>
      <CustomConnectionsFlow
        prefill={readPrefilledLink(params.url)}
        returned={{
          connectionId: readParam(params.connection),
          error: readParam(params.error),
          step: readParam(params.step),
        }}
      />
    </LinkPageFrame>
  );
}
