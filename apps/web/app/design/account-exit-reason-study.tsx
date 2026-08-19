"use client";

import { useState } from "react";

import { AccountExitReasonStep } from "@/src/components/settings/account-exit-reason-step";
import type { HostedAccountExitReasonCode } from "@/src/lib/hosted-privacy/account-data-shared";

export function AccountExitReasonStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-study="account-exit-reason"
      id="account-exit-reason"
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The first step of the delete-account dialog in{" "}
        <code>/settings</code>. Answering is optional: Skip always moves straight
        to the confirmation step, and Continue only turns on once a reason is
        picked. The note field appears after a reason is chosen so a written note
        always arrives attached to one. The live step is interactive here; the
        two previews below are inert. Successful deletion leaves this dashboard
        for the public farewell page.
      </p>

      <StepFrame label="Interactive">
        <InteractiveExitReasonStep />
      </StepFrame>

      <div className="grid gap-6 lg:grid-cols-2">
        <StepFrame inert label="Nothing picked yet · Continue disabled" state="empty">
          <AccountExitReasonStep
            note=""
            reason={null}
            onContinue={() => undefined}
            onNoteChange={() => undefined}
            onReasonChange={() => undefined}
            onSkip={() => undefined}
          />
        </StepFrame>
        <StepFrame inert label="Reason picked · note revealed" state="reason-selected">
          <AccountExitReasonStep
            note="Loved the texts, just cannot justify it this month."
            reason="too_expensive"
            onContinue={() => undefined}
            onNoteChange={() => undefined}
            onReasonChange={() => undefined}
            onSkip={() => undefined}
          />
        </StepFrame>
      </div>
    </div>
  );
}

function InteractiveExitReasonStep() {
  const [reason, setReason] = useState<HostedAccountExitReasonCode | null>(null);
  const [note, setNote] = useState("");

  return (
    <AccountExitReasonStep
      note={note}
      reason={reason}
      onContinue={() => undefined}
      onNoteChange={setNote}
      onReasonChange={setReason}
      onSkip={() => {
        setReason(null);
        setNote("");
      }}
    />
  );
}

function StepFrame(props: {
  children: React.ReactNode;
  inert?: boolean;
  label: string;
  state?: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-design-state={props.state}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      {/* Matches the delete dialog's own max-w-md so the catalog shows the
          component at the width it actually renders at. */}
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6"
        inert={props.inert}
      >
        {props.children}
      </div>
    </div>
  );
}
