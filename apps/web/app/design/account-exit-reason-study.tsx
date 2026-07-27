"use client";

import { useState } from "react";

import { AccountExitReasonStep } from "@/src/components/settings/account-exit-reason-step";
import { AccountDeletionConfirmationStep } from "@/src/components/settings/account-deletion-confirmation-step";
import type { HostedAccountExitReasonCode } from "@/src/lib/hosted-privacy/account-data-shared";

export function AccountExitReasonStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-study="account-exit-reason"
      id="account-exit-reason"
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The delete-account flow in <code>/settings</code>. The exit reason is
        optional. A retryable wearable-start conflict keeps the confirmation
        phrase in place, explains the temporary block, and offers one fresh
        retry. The live reason step is interactive here; the previews are inert.
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

      <StepFrame inert label="Wearable start still finishing · retry available" state="retryable">
        <AccountDeletionConfirmationStep
          confirmationPhrase="DELETE MY ACCOUNT"
          error="A wearable connection is still finishing. Retry account deletion in a moment."
          onCancel={() => undefined}
          onConfirmationPhraseChange={() => undefined}
          onSubmit={() => undefined}
          pending={false}
          retryAvailable
        />
      </StepFrame>
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
