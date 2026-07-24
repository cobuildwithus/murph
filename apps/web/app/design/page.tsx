import type { Metadata } from "next";
import { Suspense } from "react";
import { HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES } from "@murphai/hosted-execution/vault-share";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { projectHostedVaultShareProjectionDisplays } from "@/src/lib/hosted-groups/join-policy";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { DesignPage } from "./design-page";

const DESIGN_GROUP_JOIN_PERMISSIONS_STUDY = {
  registryPermissions: projectHostedVaultShareProjectionDisplays(
    HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  ),
};

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Design",
  description: "Brand guidelines, visual identity, and component library.",
});

export default function Page() {
  return (
    <>
      <Suspense>
        <DesignPage
          groupJoinPermissionsStudy={DESIGN_GROUP_JOIN_PERMISSIONS_STUDY}
        />
      </Suspense>
      <SiteFooter />
    </>
  );
}
