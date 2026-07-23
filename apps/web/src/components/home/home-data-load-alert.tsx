"use client";

import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";

export function HomeDataLoadAlert() {
  const router = useRouter();

  return (
    <Alert variant="destructive">
      <AlertTitle>Some dashboard details are unavailable</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Murph could not load every section right now. Try again to refresh
            the missing details.
          </span>
          <Button
            onClick={() => router.refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
