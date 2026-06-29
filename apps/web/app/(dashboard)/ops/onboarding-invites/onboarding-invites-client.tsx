"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  MicIcon,
  SendIcon,
} from "lucide-react";
import { useState, type ReactNode, type TextareaHTMLAttributes } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { cn } from "@/src/lib/utils";

type DeliveryMode = "existing_chat" | "new_chat";

interface HostedOpsOnboardingInviteResult {
  chatId: string;
  deliveryMode: DeliveryMode;
  inviteExpiresAt: string;
  inviteId: string;
  invitePreviouslyMarkedSent: boolean;
  linqFromPhoneHint: string | null;
  memberId: string;
  newChatCreated: boolean;
  openerMessageId: string | null;
  recipientPhoneHint: string;
  sentAt: string;
  textMessageSent: true;
  voiceMemo: {
    error: string | null;
    requested: boolean;
    sent: boolean;
  };
}

type PendingAction = "send" | null;

export function OnboardingInvitesClient() {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("existing_chat");
  const [requestId, setRequestId] = useState(() => createRequestId());
  const [pending, setPending] = useState<PendingAction>(null);
  const [result, setResult] = useState<HostedOpsOnboardingInviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendInvite(formData: FormData): Promise<void> {
    formData.set("deliveryMode", deliveryMode);
    formData.set("requestId", requestId);
    setPending("send");
    setError(null);
    setResult(null);

    try {
      const nextResult = await requestJson<HostedOpsOnboardingInviteResult>(
        "/api/ops/onboarding-invites",
        {
          body: formData,
          method: "POST",
        },
      );
      setResult(nextResult);
      setRequestId(createRequestId());
    } catch (sendError) {
      setError(describeClientError(sendError));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
              Onboarding invites
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Issue a hosted setup link for a phone number and deliver it through Linq, with an optional voice memo on the same send.
            </p>
          </div>
          {result ? (
            <Badge variant={result.voiceMemo.requested && !result.voiceMemo.sent ? "outline" : "secondary"}>
              <CheckCircle2Icon data-icon="inline-start" />
              Link sent to {result.recipientPhoneHint}
            </Badge>
          ) : null}
        </div>
      </header>

      <section
        aria-busy={pending === "send"}
        aria-labelledby="ops-onboarding-invite-form-title"
        className="rounded-xl border border-border/70 bg-card/90 p-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Hosted setup
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="ops-onboarding-invite-form-title"
            >
              Send invite link
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Existing chats receive the link directly. New chats start with a short non-link note, then the setup link follows.
            </p>
          </div>
          <Badge variant="outline">
            <MicIcon data-icon="inline-start" />
            Voice optional
          </Badge>
        </div>

        <form
          className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          onSubmit={(event) => {
            event.preventDefault();
            void sendInvite(new FormData(event.currentTarget));
          }}
        >
          <input name="deliveryMode" type="hidden" value={deliveryMode} />
          <input name="requestId" type="hidden" value={requestId} />

          <Field label="Recipient phone" htmlFor="ops-onboarding-recipient-phone">
            <Input
              autoComplete="off"
              id="ops-onboarding-recipient-phone"
              inputMode="tel"
              name="recipientPhoneNumber"
              placeholder="+15550000000"
              required
              spellCheck={false}
            />
          </Field>

          <Field label="Delivery target" htmlFor="ops-onboarding-delivery-target">
            <Select
              value={deliveryMode}
              onValueChange={(value) => {
                if (value === "existing_chat" || value === "new_chat") {
                  setDeliveryMode(value);
                }
              }}
            >
              <SelectTrigger id="ops-onboarding-delivery-target">
                <SelectValue placeholder="Choose target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="existing_chat">Existing Linq chat</SelectItem>
                <SelectItem value="new_chat">Create new Linq chat</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {deliveryMode === "existing_chat" ? (
            <Field label="Linq chat id" htmlFor="ops-onboarding-linq-chat-id">
              <Input
                autoComplete="off"
                id="ops-onboarding-linq-chat-id"
                name="linqChatId"
                placeholder="chat_..."
                required
                spellCheck={false}
              />
            </Field>
          ) : (
            <>
              <Field label="Sender line" htmlFor="ops-onboarding-linq-from-phone">
                <Input
                  autoComplete="off"
                  id="ops-onboarding-linq-from-phone"
                  inputMode="tel"
                  name="linqFromPhoneNumber"
                  placeholder="+15550000000"
                  required
                  spellCheck={false}
                />
              </Field>
              <Field label="Opening note" htmlFor="ops-onboarding-new-chat-opener" optional>
                <Textarea
                  id="ops-onboarding-new-chat-opener"
                  maxLength={320}
                  name="newChatOpeningMessage"
                  placeholder="Hey, I am sending the Murph setup link next."
                  rows={3}
                />
              </Field>
            </>
          )}

          <Field label="Link message" htmlFor="ops-onboarding-invite-message" optional>
            <Textarea
              id="ops-onboarding-invite-message"
              maxLength={1800}
              name="inviteMessage"
              placeholder={"Murph setup link:\n{{inviteUrl}}\n\nReply here when you are in."}
              rows={5}
            />
          </Field>

          <Field label="Voice memo" htmlFor="ops-onboarding-voice-memo" optional>
            <Input
              accept=".m4a,.mp3,.wav,.aac,.caf,.aiff,.aif,.amr,audio/aac,audio/aiff,audio/amr,audio/m4a,audio/mp4,audio/mpeg,audio/wav,audio/x-aiff,audio/x-caf,audio/x-m4a,audio/x-wav"
              id="ops-onboarding-voice-memo"
              name="voiceMemo"
              type="file"
            />
          </Field>

          <div className="flex flex-col gap-3 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {pending === "send" ? "Sending hosted setup link." : ""}
            </div>
            <Button disabled={pending !== null} type="submit">
              <SendIcon data-icon="inline-start" />
              {pending === "send" ? "Sending..." : "Send invite"}
            </Button>
          </div>
        </form>

        {error ? (
          <Alert className="mt-4" variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <InviteResultPanel result={result} />
        ) : null}
      </section>
    </div>
  );
}

function Field({
  children,
  htmlFor,
  label,
  optional = false,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          htmlFor={htmlFor}
        >
          {label}
        </Label>
        {optional ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Optional
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      spellCheck={false}
      {...props}
    />
  );
}

function InviteResultPanel({
  result,
}: {
  result: HostedOpsOnboardingInviteResult;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Delivery
          </div>
          <div className="mt-1 text-sm text-foreground">
            Setup link sent to {result.recipientPhoneHint}
          </div>
        </div>
        <Badge variant={result.newChatCreated ? "secondary" : "outline"}>
          {result.newChatCreated ? "New chat" : "Existing chat"}
        </Badge>
      </div>

      {result.voiceMemo.requested && !result.voiceMemo.sent ? (
        <Alert variant="default">
          <AlertCircleIcon data-icon="inline-start" />
          <AlertDescription className="min-w-0 break-words">
            {result.voiceMemo.error ?? "Voice memo was not sent."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
        <ResultValue label="Member" value={result.memberId} />
        <ResultValue label="Invite" value={result.inviteId} />
        <ResultValue label="Chat" value={result.chatId} />
        <ResultValue label="Sent" value={formatDateTime(result.sentAt)} />
        <ResultValue label="Expires" value={formatDateTime(result.inviteExpiresAt)} />
        <ResultValue
          label="Voice"
          value={
            result.voiceMemo.requested
              ? result.voiceMemo.sent ? "Sent" : "Failed"
              : "None"
          }
        />
        {result.linqFromPhoneHint ? (
          <ResultValue label="Sender line" value={result.linqFromPhoneHint} />
        ) : null}
        {result.openerMessageId ? (
          <ResultValue label="Opening message" value={result.openerMessageId} />
        ) : null}
        <ResultValue
          label="Prior sent marker"
          value={result.invitePreviouslyMarkedSent ? "Already marked" : "New marker"}
        />
      </div>
    </div>
  );
}

function ResultValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-xs text-foreground">
        {value}
      </div>
    </div>
  );
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? `Request failed with HTTP ${response.status}.`);
  }

  return payload as T;
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = (payload as { error?: { message?: unknown }; message?: unknown }).error?.message
    ?? (payload as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : null;
}

function describeClientError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
