"use client";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "@/src/lib/hosted-privacy/account-data-shared";

export function AccountDeletionConfirmationStep(props: {
  confirmationPhrase: string;
  error: string | null;
  onCancel: () => void;
  onConfirmationPhraseChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  retryAvailable: boolean;
}) {
  const phraseMatches =
    props.confirmationPhrase === HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
  const submitReady = phraseMatches && !props.pending;

  return (
    <>
      {props.error ? (
        <p
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {props.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="hosted-account-delete-phrase">
          Type{" "}
          <span className="font-mono">
            {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          </span>{" "}
          to confirm
        </Label>
        <Input
          aria-invalid={props.confirmationPhrase.length > 0 && !phraseMatches}
          autoComplete="off"
          className="h-12 text-base"
          disabled={props.pending}
          id="hosted-account-delete-phrase"
          inputMode="text"
          onChange={(event) => props.onConfirmationPhraseChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onSubmit();
            }
          }}
          placeholder={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          value={props.confirmationPhrase}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={!submitReady}
          onClick={props.onSubmit}
          size="xl"
          type="button"
          variant="destructive"
        >
          {props.pending
            ? "Deleting..."
            : props.retryAvailable
              ? "Retry deletion"
              : "Delete account"}
        </Button>
        <Button
          className="w-full"
          disabled={props.pending}
          onClick={props.onCancel}
          size="xl"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
