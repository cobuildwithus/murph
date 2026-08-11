"use client";

import { SearchIcon, SendIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import type {
  HostedOpsMemberEmailPreviewProof,
  HostedOpsMemberEmailRecipientStatus,
  HostedOpsMemberEmailResult,
} from "@/src/lib/hosted-ops/member-email";

type PendingAction = "preview" | "send" | null;
type FailedAction = Exclude<PendingAction, null>;

const MEMBER_EMAIL_MAX_RECIPIENTS = 100;
const MEMBER_EMAIL_MAX_SUBJECT_LENGTH = 200;
const MEMBER_EMAIL_MAX_TEXT_LENGTH = 20_000;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const PREVIEW_STALE_ERROR_CODE = "HOSTED_OPS_MEMBER_EMAIL_PREVIEW_STALE";
const RECIPIENT_STATUSES = new Set<unknown>([
  "member_not_found",
  "member_suspended",
  "no_email",
  "ready",
  "sent",
]);

export function MemberEmailClient() {
  const [memberIdsText, setMemberIdsText] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<HostedOpsMemberEmailResult | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);
  const memberIds = useMemo(
    () => parseHostedOpsMemberIds(memberIdsText),
    [memberIdsText],
  );
  const memberIdsError = readMemberIdsError({ memberIds, memberIdsText });
  const draftIsValid = !memberIdsError &&
    memberIds.length > 0 &&
    subject.trim().length > 0 &&
    subject.length <= MEMBER_EMAIL_MAX_SUBJECT_LENGTH &&
    text.trim().length > 0 &&
    text.length <= MEMBER_EMAIL_MAX_TEXT_LENGTH;
  const sendableCount = result?.outcome === "preview"
    ? result.summary.readyCount
    : 0;

  function updateDraft(update: () => void): void {
    update();
    setResult(null);
    setError(null);
    setFailedAction(null);
  }

  async function previewEmail(): Promise<void> {
    if (!draftIsValid) {
      return;
    }
    setPending("preview");
    setError(null);
    setFailedAction(null);
    try {
      setResult(await requestMemberEmail({
        memberIds,
        mode: "preview",
        previewProof: null,
        subject,
        text,
      }));
    } catch (requestError) {
      setFailedAction("preview");
      setError(readRequestErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function sendEmail(): Promise<void> {
    if (
      !result?.previewProof ||
      result.outcome !== "preview" ||
      result.summary.readyCount === 0
    ) {
      return;
    }
    setPending("send");
    setError(null);
    setFailedAction(null);
    try {
      setResult(await requestMemberEmail({
        memberIds,
        mode: "send",
        previewProof: result.previewProof,
        subject,
        text,
      }));
    } catch (requestError) {
      setFailedAction("send");
      if (isPreviewStaleRequestError(requestError)) {
        setResult(null);
        setError(readRequestErrorMessage(requestError));
      } else {
        setError(
          "The send could not be confirmed. Retry Send with the same Preview; Resend will reuse the same idempotency key.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="max-w-3xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Ops notebook
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Member email
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Draft one plain-text email for an explicit list of members. Preview
            resolves the current recipients before anything is sent.
          </p>
        </div>
      </header>

      <section
        aria-busy={pending !== null}
        aria-labelledby="member-email-composer-title"
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:gap-10"
      >
        <div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Plain text
            </span>
            <h2
              className="font-serif text-xl font-semibold tracking-tight text-foreground"
              id="member-email-composer-title"
            >
              Compose
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Verified email is used first, with the Stripe checkout email as
              fallback. Recipient addresses stay server-side.
            </p>
          </div>

          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              void previewEmail();
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(memberIdsError)}>
                <FieldLabel htmlFor="member-email-member-ids">
                  Member IDs
                </FieldLabel>
                <Textarea
                  aria-describedby="member-email-member-ids-description"
                  aria-errormessage={memberIdsError
                    ? "member-email-member-ids-error"
                    : undefined}
                  aria-invalid={Boolean(memberIdsError)}
                  autoComplete="off"
                  className="min-h-32 resize-y font-mono text-xs leading-5"
                  disabled={pending !== null}
                  id="member-email-member-ids"
                  onChange={(event) => updateDraft(() => {
                    setMemberIdsText(event.target.value);
                  })}
                  placeholder={"hbm_member_1\nhbm_member_2"}
                  required
                  spellCheck={false}
                  value={memberIdsText}
                />
                <FieldDescription id="member-email-member-ids-description">
                  One per line, or separated by spaces or commas. Up to 100
                  unique members.
                </FieldDescription>
                {memberIdsError ? (
                  <FieldError id="member-email-member-ids-error">
                    {memberIdsError}
                  </FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={subject.length > MEMBER_EMAIL_MAX_SUBJECT_LENGTH}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <FieldLabel htmlFor="member-email-subject">Subject</FieldLabel>
                  <CharacterCount
                    current={subject.length}
                    id="member-email-subject-count"
                    maximum={MEMBER_EMAIL_MAX_SUBJECT_LENGTH}
                  />
                </div>
                <Input
                  aria-describedby="member-email-subject-count"
                  aria-errormessage={subject.length > MEMBER_EMAIL_MAX_SUBJECT_LENGTH
                    ? "member-email-subject-error"
                    : undefined}
                  aria-invalid={subject.length > MEMBER_EMAIL_MAX_SUBJECT_LENGTH}
                  autoComplete="off"
                  disabled={pending !== null}
                  id="member-email-subject"
                  onChange={(event) => updateDraft(() => {
                    setSubject(event.target.value);
                  })}
                  placeholder="Your Murph access is ready again"
                  required
                  value={subject}
                />
                {subject.length > MEMBER_EMAIL_MAX_SUBJECT_LENGTH ? (
                  <FieldError id="member-email-subject-error">
                    Subject must be 200 characters or fewer.
                  </FieldError>
                ) : null}
              </Field>

              <Field data-invalid={text.length > MEMBER_EMAIL_MAX_TEXT_LENGTH}>
                <div className="flex items-baseline justify-between gap-4">
                  <FieldLabel htmlFor="member-email-text">Message</FieldLabel>
                  <CharacterCount
                    current={text.length}
                    id="member-email-text-count"
                    maximum={MEMBER_EMAIL_MAX_TEXT_LENGTH}
                  />
                </div>
                <Textarea
                  aria-describedby="member-email-text-count member-email-text-description"
                  aria-errormessage={text.length > MEMBER_EMAIL_MAX_TEXT_LENGTH
                    ? "member-email-text-error"
                    : undefined}
                  aria-invalid={text.length > MEMBER_EMAIL_MAX_TEXT_LENGTH}
                  className="min-h-72 resize-y leading-6"
                  disabled={pending !== null}
                  id="member-email-text"
                  onChange={(event) => updateDraft(() => {
                    setText(event.target.value);
                  })}
                  placeholder={"Hey,\n\nI added more usage to your Murph account..."}
                  required
                  value={text}
                />
                <FieldDescription id="member-email-text-description">
                  The message is sent exactly as plain text.
                </FieldDescription>
                {text.length > MEMBER_EMAIL_MAX_TEXT_LENGTH ? (
                  <FieldError id="member-email-text-error">
                    Message must be 20,000 characters or fewer.
                  </FieldError>
                ) : null}
              </Field>
            </FieldGroup>

            <div className="mt-6 flex items-center justify-between gap-4 border-t border-border/70 pt-5">
              <span className="text-xs text-muted-foreground">
                {memberIds.length > 0
                  ? `${memberIds.length} unique member${memberIds.length === 1 ? "" : "s"}`
                  : "No members entered"}
              </span>
              {result?.outcome === "sent" ? (
                <Badge variant="secondary">Batch complete</Badge>
              ) : (
                <Button
                  disabled={!draftIsValid || pending !== null}
                  onClick={() => void previewEmail()}
                  type="button"
                  variant="outline"
                >
                  <SearchIcon data-icon="inline-start" />
                  {pending === "preview" ? "Previewing..." : "Preview recipients"}
                </Button>
              )}
            </div>
          </form>
        </div>

        <aside className="border-t border-border/70 pt-6 lg:sticky lg:top-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
            Send check
          </span>
          <h2 className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
            Recipients
          </h2>

          {error ? (
            <Alert className="mt-5" variant="destructive">
              <AlertTitle>
                {failedAction === "preview" ? "Preview failed" : "Send not confirmed"}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!result ? (
            <div className="mt-5 rounded-xl border border-dashed border-border px-5 py-10 text-center">
              <p className="font-serif text-base font-medium text-foreground">
                Nothing ready yet
              </p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                Complete the draft and preview it to check who can receive the
                email. No addresses will be shown.
              </p>
            </div>
          ) : (
            <>
              <ResultSummary result={result} />

              <div className="mt-5 overflow-hidden rounded-xl border border-border/70">
                <div className="divide-y divide-border/70">
                  {result.recipients.map((recipient) => (
                    <div
                      className="flex items-center justify-between gap-4 px-4 py-3"
                      key={recipient.memberId}
                    >
                      <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                        {recipient.memberId}
                      </span>
                      <RecipientStatusBadge status={recipient.status} />
                    </div>
                  ))}
                </div>
              </div>

              {result.outcome === "preview" && sendableCount > 0 &&
                  result.previewProof ? (
                <div className="mt-5">
                  <Alert>
                    <AlertTitle>Sends immediately</AlertTitle>
                    <AlertDescription>
                      Each member receives a separate email. Unknown,
                      suspended, and no-email members stay skipped.
                    </AlertDescription>
                  </Alert>
                  <Button
                    className="mt-4 w-full"
                    disabled={pending !== null}
                    onClick={() => void sendEmail()}
                    size="lg"
                    type="button"
                  >
                    <SendIcon data-icon="inline-start" />
                    {pending === "send"
                      ? "Sending..."
                      : `Send to ${sendableCount} member${sendableCount === 1 ? "" : "s"}`}
                  </Button>
                </div>
              ) : null}
            </>
          )}

          <p aria-live="polite" className="sr-only">
            {readAnnouncedStatus({ error, pending, result })}
          </p>
        </aside>
      </section>
    </div>
  );
}

function CharacterCount(input: {
  current: number;
  id?: string;
  maximum: number;
}) {
  return (
    <span
      className={input.current > input.maximum
        ? "font-mono text-[10px] text-destructive"
        : "font-mono text-[10px] text-muted-foreground"}
      id={input.id}
    >
      {input.current.toLocaleString("en-US")} / {input.maximum.toLocaleString("en-US")}
    </span>
  );
}

function ResultSummary({ result }: { result: HostedOpsMemberEmailResult }) {
  const columns = result.outcome === "sent"
    ? [
        ["Requested", result.summary.requestedCount],
        ["Sent", result.summary.sentCount],
        ["Skipped", result.summary.skippedCount],
      ] as const
    : [
        ["Requested", result.summary.requestedCount],
        ["Ready", result.summary.readyCount],
        ["Skipped", result.summary.skippedCount],
      ] as const;

  return (
    <div className="mt-5">
      <div className="grid grid-cols-3 divide-x divide-border/70 rounded-xl border border-border/70 bg-card">
        {columns.map(([label, value]) => (
          <div className="px-3 py-4 text-center" key={label}>
            <div className="font-serif text-2xl font-semibold text-foreground">
              {value}
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {result.message}
      </p>
    </div>
  );
}

function RecipientStatusBadge({
  status,
}: {
  status: HostedOpsMemberEmailRecipientStatus;
}) {
  const label = {
    member_not_found: "Not found",
    member_suspended: "Suspended",
    no_email: "No email",
    ready: "Ready",
    sent: "Sent",
  }[status];
  return (
    <Badge variant={status === "ready" || status === "sent" ? "secondary" : "outline"}>
      {label}
    </Badge>
  );
}

export function parseHostedOpsMemberIds(value: string): string[] {
  const memberIds: string[] = [];
  for (const candidate of value.split(/[\s,]+/u)) {
    const memberId = candidate.trim();
    if (memberId && !memberIds.includes(memberId)) {
      memberIds.push(memberId);
    }
  }
  return memberIds;
}

function readMemberIdsError(input: {
  memberIds: string[];
  memberIdsText: string;
}): string | null {
  if (!input.memberIdsText.trim()) {
    return null;
  }
  if (input.memberIds.length > MEMBER_EMAIL_MAX_RECIPIENTS) {
    return `Enter no more than ${MEMBER_EMAIL_MAX_RECIPIENTS} unique member IDs.`;
  }
  if (input.memberIds.some((memberId) => !MEMBER_ID_PATTERN.test(memberId))) {
    return "One or more member IDs has an invalid format.";
  }
  return null;
}

async function requestMemberEmail(input: {
  memberIds: string[];
  mode: "preview" | "send";
  previewProof: HostedOpsMemberEmailPreviewProof | null;
  subject: string;
  text: string;
}): Promise<HostedOpsMemberEmailResult> {
  const response = await fetch("/api/ops/member-email", {
    body: JSON.stringify({
      memberIds: input.memberIds,
      mode: input.mode,
      ...(input.previewProof ? { previewProof: input.previewProof } : {}),
      subject: input.subject,
      text: input.text,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MemberEmailRequestError(
      "Member email returned an unreadable response.",
      null,
    );
  }
  if (!response.ok) {
    throw new MemberEmailRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isHostedOpsMemberEmailResult(payload)) {
    throw new MemberEmailRequestError(
      "Member email returned an invalid response.",
      null,
    );
  }
  return payload;
}

class MemberEmailRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
    this.name = "MemberEmailRequestError";
  }
}

function isPreviewStaleRequestError(error: unknown): boolean {
  return error instanceof MemberEmailRequestError &&
    error.code === PREVIEW_STALE_ERROR_CODE;
}

function isHostedOpsMemberEmailResult(
  value: unknown,
): value is HostedOpsMemberEmailResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const recipients = Reflect.get(value, "recipients");
  const summary = Reflect.get(value, "summary");
  const previewProof = Reflect.get(value, "previewProof");
  return (
    (Reflect.get(value, "outcome") === "preview" ||
      Reflect.get(value, "outcome") === "sent") &&
    typeof Reflect.get(value, "message") === "string" &&
    Array.isArray(recipients) &&
    recipients.every(isHostedOpsMemberEmailRecipientResult) &&
    isHostedOpsMemberEmailSummary(summary) &&
    (
      previewProof === null ||
      isHostedOpsMemberEmailPreviewProof(previewProof)
    )
  );
}

function isHostedOpsMemberEmailRecipientResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof Reflect.get(value, "memberId") === "string" &&
      RECIPIENT_STATUSES.has(Reflect.get(value, "status")),
  );
}

function isHostedOpsMemberEmailSummary(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ["readyCount", "requestedCount", "sentCount", "skippedCount"].every(
        (key) => {
          const count = Reflect.get(value, key);
          return typeof count === "number" &&
            Number.isSafeInteger(count) &&
            count >= 0;
        },
      ),
  );
}

function isHostedOpsMemberEmailPreviewProof(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof Reflect.get(value, "previewedAt") === "string" &&
      typeof Reflect.get(value, "token") === "string",
  );
}

function readResponseErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = Reflect.get(payload, "error");
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function readResponseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Member email failed. Try again.";
  }
  const error = Reflect.get(payload, "error");
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return "Member email failed. Try again.";
}

function readRequestErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Member email failed. Try again.";
}

function readAnnouncedStatus(input: {
  error: string | null;
  pending: PendingAction;
  result: HostedOpsMemberEmailResult | null;
}): string {
  if (input.pending === "preview") {
    return "Checking member email recipients.";
  }
  if (input.pending === "send") {
    return "Sending member email batch.";
  }
  if (input.error || !input.result) {
    return "";
  }
  return input.result.message;
}
