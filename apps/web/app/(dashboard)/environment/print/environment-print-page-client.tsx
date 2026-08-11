"use client";

import { useMemo } from "react";
import Link from "next/link";
import { HABITAT_DECLINED_VALUE } from "@murphai/contracts";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

import { deriveCategoryNote, overallGrade } from "../category-notes";
import {
  EnvironmentPrintLoading,
  EnvironmentPrintReport,
} from "../environment-print-report";
import { selectEnvironmentHabitatValues } from "../habitat-values";
import {
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "../home-model";

export function EnvironmentPrintPageClient({
  generatedOn,
}: {
  generatedOn: string;
}) {
  const { client, error, status } = useBrowserVault();
  const values = useMemo(
    () => (client ? selectEnvironmentHabitatValues(client) : {}),
    [client],
  );
  const scene = useMemo(() => resolveHabitatScene(values), [values]);
  const notes = useMemo(
    () => scene.categories.map((category) => deriveCategoryNote(category, values)),
    [scene, values],
  );
  const grade = useMemo(() => overallGrade(notes), [notes]);
  const coverage = useMemo(() => resolveEnvironmentCoverage(scene), [scene]);

  if (status === "loading") {
    return <EnvironmentPrintLoading />;
  }

  if (status === "error") {
    return (
      <PrintStatus>
        <Alert variant="destructive">
          <AlertTitle>Could not load your Environment report</AlertTitle>
          <AlertDescription>
            {error ?? "Murph could not unlock your private Habitat records right now."}
          </AlertDescription>
        </Alert>
      </PrintStatus>
    );
  }

  if (scene.known === 0) {
    return (
      <PrintStatus>
        <p>There is no Environment report to print yet.</p>
        <Link href="/environment" className="text-primary underline underline-offset-4">
          Add your home details
        </Link>
      </PrintStatus>
    );
  }

  return (
    <EnvironmentPrintReport
      context={{
        areaType: printableContextValue(values["home-location"]?.area_type),
        location: printableContextValue(values["home-location"]?.location),
      }}
      coverage={coverage}
      generatedOn={generatedOn}
      grade={grade}
      notes={notes}
    />
  );
}

function printableContextValue(value: unknown): string | null {
  if (
    value === HABITAT_DECLINED_VALUE
    || (
      typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "boolean"
    )
  ) {
    return null;
  }
  return String(value).replaceAll("_", " ");
}

function PrintStatus({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto flex min-h-[40vh] w-full max-w-3xl flex-col justify-center gap-4 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
      {children}
    </section>
  );
}
