"use client";

import { PulseTrialBillingContinuationView } from "@/src/components/settings/hosted-start-paid-pulse-button";

const NOOP = () => {};

export function PulseTrialBillingContinuationStudy() {
  return (
    <div
      className="grid gap-5 lg:grid-cols-2"
      data-design-section="pulse-trial-billing-continuation"
      id="pulse-trial-billing-continuation-section"
      inert
    >
      <ContinuationPreview label="Start paid Pulse now">
        <PulseTrialBillingContinuationView
          action="start_pulse_now"
          errorMessage={null}
          onConfirm={NOOP}
          onDismiss={NOOP}
          status="confirming"
        />
      </ContinuationPreview>
      <ContinuationPreview label="Active trial return receipt">
        <PulseTrialBillingContinuationView
          action="continue_pulse"
          errorMessage={null}
          onConfirm={NOOP}
          onDismiss={NOOP}
          status="continuing"
        />
      </ContinuationPreview>
      <ContinuationPreview label="Paid-at-boundary return receipt">
        <PulseTrialBillingContinuationView
          action="continue_pulse"
          errorMessage={null}
          onConfirm={NOOP}
          onDismiss={NOOP}
          status="active"
        />
      </ContinuationPreview>
      <ContinuationPreview label="Ended or paused return">
        <PulseTrialBillingContinuationView
          action="continue_pulse"
          errorMessage={null}
          onConfirm={NOOP}
          onDismiss={NOOP}
          status="start_required"
        />
      </ContinuationPreview>
    </div>
  );
}

function ContinuationPreview(props: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      {props.children}
    </div>
  );
}
