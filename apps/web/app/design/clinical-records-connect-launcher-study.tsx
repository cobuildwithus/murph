import type { ReactNode } from "react";

import { RecordsConnectLauncherState } from "@/app/(dashboard)/records/connect/records-connect-client";

export function ClinicalRecordsConnectLauncherStudy() {
  return (
    <div
      className="grid gap-6 xl:grid-cols-2"
      data-design-section="clinical-records-connect-launcher"
      inert
    >
      <StudyState label="Authenticated launcher loading">
        <RecordsConnectLauncherState state="loading" />
      </StudyState>
      <StudyState label="Launcher needs sign-in">
        <RecordsConnectLauncherState state="authentication-required" />
      </StudyState>
      <StudyState label="Launcher can be retried">
        <RecordsConnectLauncherState state="launch-failed" />
      </StudyState>
    </div>
  );
}

function StudyState({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="min-w-0 rounded-2xl border bg-background p-5 sm:p-7">
        {children}
      </div>
    </div>
  );
}
