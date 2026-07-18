import type { Metadata } from "next";

import { RecordsPageClient } from "./records-page-client";
import {
  CLINICAL_RECORD_CALLBACK_MARKERS,
  type ClinicalRecordCallbackMarker,
  type ClinicalRecordConnectionContract,
} from "@/src/lib/clinical-records/client-contracts";
import { listClinicalRecordConnectionsForMember } from "@/src/lib/clinical-records/connections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Medical records | Murph",
  description: "Connect a supported patient portal and see which lab results and report summaries Murph copied.",
});

type RecordsSearchParams = {
  clinicalRecords?: string | string[] | undefined;
};

export default async function RecordsPage({
  searchParams,
}: {
  searchParams?: Promise<RecordsSearchParams>;
} = {}) {
  const [auth, resolvedSearchParams] = await Promise.all([
    getHostedDashboardPageAuthSnapshot(),
    searchParams ?? Promise.resolve<RecordsSearchParams>({}),
  ]);
  const member = auth.authenticatedMember;
  let initialConnections: readonly ClinicalRecordConnectionContract[] = [];
  let initialLoadError = false;

  if (member) {
    try {
      initialConnections = await listClinicalRecordConnectionsForMember(member.id);
    } catch (error) {
      initialLoadError = true;
      console.warn("Clinical Records connections were unavailable during page render.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return (
    <RecordsPageClient
      authenticated={member !== null}
      initialCallback={readCallbackMarker(resolvedSearchParams.clinicalRecords)}
      initialConnections={initialConnections}
      initialLoadError={initialLoadError}
    />
  );
}

function readCallbackMarker(
  value: string | string[] | undefined,
): ClinicalRecordCallbackMarker | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (
    CLINICAL_RECORD_CALLBACK_MARKERS.find((marker) => marker === candidate) ?? null
  );
}
