import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  OpsUsageDialogStudy,
  OPS_USAGE_DIALOG_STATES,
  type OpsUsageDialogState,
} from "../../../design/ops-usage-study";

export const dynamicParams = false;

export function generateStaticParams() {
  return OPS_USAGE_DIALOG_STATES.map((state) => ({ state }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const requestedState = (await params).state;
  return {
    title: isOpsUsageDialogState(requestedState)
      ? `Ops usage ${requestedState} dialog | Murph screenshots`
      : "Murph | Screenshots",
    robots: { follow: false, index: false },
  };
}

export default async function OpsUsageDialogScreenshotPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const requestedState = (await params).state;
  if (!isOpsUsageDialogState(requestedState)) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f5f0e8] text-[#2d3436]">
      <OpsUsageDialogStudy state={requestedState} />
    </main>
  );
}

function isOpsUsageDialogState(
  value: string,
): value is OpsUsageDialogState {
  return OPS_USAGE_DIALOG_STATES.some((state) => state === value);
}
