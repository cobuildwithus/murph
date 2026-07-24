"use client";

import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { Textarea } from "@/src/components/ui/textarea";
import {
  HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH,
  HOSTED_ACCOUNT_EXIT_REASONS,
  type HostedAccountExitReasonCode,
  isHostedAccountExitReasonCode,
} from "@/src/lib/hosted-privacy/account-data-shared";

const REASON_INPUT_ID_PREFIX = "hosted-account-exit-reason";
const NOTE_INPUT_ID = "hosted-account-exit-note";

/**
 * The optional "why are you leaving" step shown before the delete confirmation.
 * Answering never gates deletion, so Skip is always available and Continue only
 * turns on once there is something to send. The note appears after a reason is
 * picked so a written note always arrives attached to one.
 */
export function AccountExitReasonStep(props: {
  disabled?: boolean;
  note: string;
  onContinue: () => void;
  onNoteChange: (note: string) => void;
  onReasonChange: (reason: HostedAccountExitReasonCode) => void;
  onSkip: () => void;
  reason: HostedAccountExitReasonCode | null;
}) {
  const disabled = props.disabled ?? false;

  return (
    <div className="flex flex-col gap-6" data-testid="account-exit-reason-step">
      <RadioGroup
        aria-label="Why are you leaving?"
        className="gap-1"
        disabled={disabled}
        value={props.reason ?? ""}
        onValueChange={(value) => {
          if (isHostedAccountExitReasonCode(value)) {
            props.onReasonChange(value);
          }
        }}
      >
        {HOSTED_ACCOUNT_EXIT_REASONS.map((option) => {
          const inputId = `${REASON_INPUT_ID_PREFIX}-${option.code}`;
          return (
            <Label
              key={option.code}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm leading-6 font-normal text-foreground transition-colors hover:bg-primary/5 has-data-checked:bg-primary/10"
              htmlFor={inputId}
            >
              <RadioGroupItem id={inputId} value={option.code} />
              {option.label}
            </Label>
          );
        })}
      </RadioGroup>

      {props.reason ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={NOTE_INPUT_ID}>Anything else? (optional)</Label>
          <Textarea
            disabled={disabled}
            id={NOTE_INPUT_ID}
            maxLength={HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH}
            rows={3}
            value={props.note}
            onChange={(event) => props.onNoteChange(event.target.value)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={disabled || !props.reason}
          size="xl"
          type="button"
          onClick={props.onContinue}
        >
          Continue
        </Button>
        <Button
          className="w-full"
          disabled={disabled}
          size="xl"
          type="button"
          variant="ghost"
          onClick={props.onSkip}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}
