"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";

export function DashboardCriticalLoadError({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8" role="alert">
      <PageHeader
        description="Murph could not load this dashboard right now. Try again in a moment."
        eyebrow="Live Well"
        title="Your dashboard could not be loaded"
      />
      <div>
        <Button onClick={onRetry ?? (() => router.refresh())} type="button">
          Try again
        </Button>
      </div>
    </div>
  );
}
