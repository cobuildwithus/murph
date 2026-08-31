"use client";

import {
  ArrowRight,
  Copy,
} from "lucide-react";
import {
  useId,
  useRef,
  useState,
} from "react";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Textarea } from "@/src/components/ui/textarea";
import {
  withPublicGoalContactDraft,
} from "@/src/lib/goals/goal-contact";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function GoalContactAction({
  options,
  startPrompt,
}: {
  options: readonly MurphContactOption[];
  startPrompt: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(startPrompt);
  const [copyState, setCopyState] = useState<GoalMessageCopyState>("idle");
  const messageDescriptionId = useId();
  const messageId = useId();
  const openOptionsLabelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function copyMessage() {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopyState("copy_error");
      textareaRef.current?.focus();
      if (typeof textareaRef.current?.select === "function") {
        textareaRef.current.select();
      }
      return;
    }

    void clipboard.writeText(draft).then(
      () => {
        setCopyState("copied");
      },
      () => {
        setCopyState("copy_error");
        textareaRef.current?.focus();
        if (typeof textareaRef.current?.select === "function") {
          textareaRef.current.select();
        }
      },
    );
  }

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCopyState("idle");
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={(
          <Button size="lg">
            Do this with Murph
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            Do this with Murph
          </DialogTitle>
          <DialogDescription>
            Review your message, then choose an app. The same click copies it
            in case the app does not keep the draft.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={messageId}>
              1. Review or edit your message
            </FieldLabel>
            <Textarea
              ref={textareaRef}
              aria-describedby={messageDescriptionId}
              id={messageId}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setCopyState("idle");
              }}
              rows={3}
              value={draft}
            />
            <FieldDescription
              aria-live="polite"
              id={messageDescriptionId}
            >
              {readCopyStatus(copyState)}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <div
          aria-labelledby={openOptionsLabelId}
          className="flex flex-col gap-2"
          role="group"
        >
          <p className="text-sm font-medium" id={openOptionsLabelId}>
            2. Copy and open Murph
          </p>
          {options.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => {
                const intentOption = withPublicGoalContactDraft(option, draft);
                return (
                  <Button
                    key={option.kind}
                    nativeButton={false}
                    render={(
                      <a
                        aria-label={`Copy message and open Murph in ${option.label}${
                          intentOption.target === "_blank"
                            ? " (opens in a new tab)"
                            : ""
                        }`}
                        href={intentOption.href}
                        onClick={copyMessage}
                        rel={intentOption.rel}
                        target={intentOption.target}
                      />
                    )}
                    variant="outline"
                  >
                    <Copy data-icon="inline-start" aria-hidden="true" />
                    Copy & open {option.label}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Copy the message, then open your existing Murph conversation.
            </p>
          )}
          {copyState === "copy_error" ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {options.map((option) => {
                const intentOption = withPublicGoalContactDraft(option, draft);
                return (
                  <MurphContactLink
                    actionLabel="Open Murph without copying"
                    className="text-sm font-medium text-primary underline underline-offset-4"
                    key={option.kind}
                    option={intentOption}
                  >
                    Open {option.label} without copying
                  </MurphContactLink>
                );
              })}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type GoalMessageCopyState = "copied" | "copy_error" | "idle";

function readCopyStatus(state: GoalMessageCopyState): string {
  return state === "copied"
    ? "Message copied. Paste it if the app did not include the draft."
    : state === "copy_error"
      ? "Copying was blocked. Select and copy the message manually, then use an open-only link below."
      : "The app may drop a website draft, so this action copies the same message as a fallback.";
}
