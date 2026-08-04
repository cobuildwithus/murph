import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  buildDeviceSyncCompletionHomeRedirectHref,
  type DeviceSyncCompletionSearchParams,
} from "@/src/lib/device-sync/connect-completion";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Device Connected - Murph",
  description: "Finish a wearable connection in Murph.",
});

export default async function DeviceSyncConnectCompletePage({
  searchParams,
}: {
  searchParams: Promise<DeviceSyncCompletionSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  redirect(buildDeviceSyncCompletionHomeRedirectHref(resolvedSearchParams));
}
