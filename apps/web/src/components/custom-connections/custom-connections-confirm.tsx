"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { LinkPagePair } from "@/src/components/link-page/link-page-pair";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { cn } from "@/src/lib/utils";

import {
  customConnectionActionUrl,
  describeCustomConnectionActionFailure,
  type CustomConnectionActionFailure,
  type CustomConnectionActionOutcome,
  type CustomConnectionActionRequest,
} from "./custom-connections-copy";
import { QUIET_TEXT_CLASS, ROW_CLASS } from "./custom-connections-screens";

type Decision = "confirm" | "decline";
const VALUE_CLASS = "whitespace-pre-wrap break-words text-[17px] font-semibold leading-[22px]";
const NESTED_CLASS = "mt-1 flex flex-col gap-1.5 border-l border-[#FFFCF6]/15 pl-3";
const MARK_CLASS = "rounded bg-[#EBD18B]/15 px-1 font-mono text-[12px] font-medium not-italic text-[#EBD18B]";
// Deeper than this, a value is shown as its raw text rather than indented further.
const NESTED_DEPTH_MAX = 3;
// The member fixes these in Settings before Murph asks again.
const FIXED_IN_SETTINGS = new Set<CustomConnectionActionFailure>(["changed", "off", "signed_out"]);
// Characters that change how text reads without showing: bidi and other format controls, control codes, invisible fillers.
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0008\u000B-\u001F\u007F-\u009F\u115F\u1160\u3164\uFFA0]/gu;
// Two or more blank lines in a row.
const BLANK_RUN = /\n(?:[^\S\n]*\n){2,}/gu;

const subscribeToNothing = () => () => undefined;
function useInBrowser(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false);
}
function codePoint(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * The member's page for one change Murph asked to make: what it is, exactly what will be sent, and their answer.
 * Do it runs the member's approval passkey over this exact request, as action approvals do; Don't needs nothing more.
 */
export function CustomConnectionConfirm({
  pending: shownPending = null,
  request,
}: {
  /** A pressed button, for the design page. */
  pending?: Decision | null;
  request: CustomConnectionActionRequest;
}) {
  const authorization = useSensitiveActionAuthorization();
  const router = useRouter();
  const [outcome, setOutcome] = useState<CustomConnectionActionOutcome>(request.outcome);
  const [pending, setPending] = useState<Decision | null>(shownPending);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStatus = useRef(outcome.status);

  // Screen readers and keyboards start the answer at its headline.
  useEffect(() => {
    if (shownStatus.current === outcome.status) return;
    shownStatus.current = outcome.status;
    headingRef.current?.focus();
  }, [outcome.status]);

  async function signConfirmation() {
    const getChallenge = () => requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      url: customConnectionActionUrl(request.id, "/challenge"),
    });
    // Sets up the member's Murph passkey first when they have none, as the approval card does.
    return authorization.signChallenge(await getChallenge(), undefined, getChallenge);
  }

  async function decide(decision: Decision) {
    setPending(decision);
    setError(null);
    try {
      const payload = decision === "confirm" ? { authorization: await signConfirmation(), decision } : { decision };
      const result = await requestHostedOnboardingJson<{ outcome: CustomConnectionActionOutcome }>({
        method: "POST",
        payload,
        url: customConnectionActionUrl(request.id),
      });
      setOutcome(result.outcome);
    } catch (caught) {
      // Answered somewhere else in the meantime: the page reloads to show what became of it.
      if (caught instanceof HostedOnboardingApiError && caught.code === "request_closed") router.refresh();
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {outcome.status === "waiting" ? (
        <WaitingScreen decide={decide} error={error} headingRef={headingRef} pending={pending} request={request} />
      ) : (
        <OutcomeScreen headingRef={headingRef} outcome={outcome} request={request} />
      )}
      <p aria-live="polite" className="sr-only" role="status">
        {pending === "confirm" ? "Doing it…" : pending === "decline" ? "Saying no…" : null}
      </p>
    </>
  );
}

function place(request: CustomConnectionActionRequest): string {
  return request.host === request.server ? request.server : `${request.server} (${request.host})`;
}

/** The action's own title, asked as a question, with anything invisible in it shown. */
function question(title: string): string {
  const shown = title.replace(INVISIBLE, (character) => `[${codePoint(character)}]`);
  return `${shown.trim().replace(/[.!?…]+$/u, "")}?`;
}

function WaitingScreen({
  decide,
  error,
  headingRef,
  pending,
  request,
}: {
  decide: (decision: Decision) => Promise<void>;
  error: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  pending: Decision | null;
  request: CustomConnectionActionRequest;
}) {
  const busy = pending !== null;
  // Everything Murph will send comes first; the answer follows it on the page.
  return (
    <LinkPageScreen
      actions={
        <>
          {error ? <LinkPageError>{error}</LinkPageError> : null}
          <LinkPagePill disabled={busy} onClick={() => void decide("confirm")}>
            {pending === "confirm" ? "Doing it…" : "Do it"}
          </LinkPagePill>
          <LinkPageLink disabled={busy} onClick={() => void decide("decline")}>
            Don&apos;t
          </LinkPageLink>
        </>
      }
      announceDetail={false}
      below={
        <div className="flex flex-col gap-2 pt-5">
          {request.confirmedBefore ? <ConfirmedBefore at={request.confirmedBefore} /> : null}
          <ActionInputs inputs={request.inputs ?? []} />
          <AskedAt askedAt={request.askedAt} />
        </div>
      }
      detail={`Murph wants to do this in ${place(request)}.`}
      headingRef={headingRef}
      title={question(request.title)}
    />
  );
}

/** The same change confirmed before may already have run, so the member hears that before confirming again. */
function ConfirmedBefore({ at }: { at: string }) {
  const day = useInBrowser() ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(at)) : null;
  return (
    <p className={cn(ROW_CLASS, "text-[15px] font-semibold leading-5 text-[#EBD18B]")}>
      {day ? `You confirmed this same change on ${day}.` : "You confirmed this same change before."} It may already have happened.
    </p>
  );
}

/** Every input, in the action's declared order, exactly as Murph will send it. */
function ActionInputs({ inputs }: { inputs: { name: string; value: unknown }[] }) {
  if (inputs.length === 0) {
    return <p className={cn(ROW_CLASS, QUIET_TEXT_CLASS)}>Murph sends no details with this one.</p>;
  }
  return (
    <dl aria-label="What Murph will send" className="flex flex-col gap-2">
      {inputs.map(({ name, value }) => (
        <div className={cn(ROW_CLASS, "flex flex-col gap-0.5")} key={name}>
          <dt className={cn(QUIET_TEXT_CLASS, "break-words")}>
            <VisibleText text={name} />
          </dt>
          <dd>
            <InputValue depth={0} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A value with its kind showing: text as text, and yes/no, numbers and empty values marked, so none passes for another. */
function InputValue({ depth, value }: { depth: number; value: unknown }) {
  if (typeof value === "string") return <TextValue text={value} />;
  if (typeof value === "boolean") return <TypedValue hint="yes/no">{value ? "Yes" : "No"}</TypedValue>;
  if (typeof value === "number") return <TypedValue hint="number">{String(value)}</TypedValue>;
  if (value === null || typeof value !== "object") return <TypedValue hint="empty" quiet>Nothing</TypedValue>;
  if (depth >= NESTED_DEPTH_MAX) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-5">
        <VisibleText text={JSON.stringify(value, null, 2)} />
      </pre>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <TypedValue hint="list" quiet>None</TypedValue>;
    return (
      <ol className={NESTED_CLASS}>
        {value.map((item, index) => (
          <li key={index}>
            <InputValue depth={depth + 1} value={item} />
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <TypedValue hint="group" quiet>None</TypedValue>;
  return (
    <dl className={NESTED_CLASS}>
      {entries.map(([name, item]) => (
        <div className="flex flex-col" key={name}>
          <dt className={cn(QUIET_TEXT_CLASS, "break-words")}>
            <VisibleText text={name} />
          </dt>
          <dd>
            <InputValue depth={depth + 1} value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TypedValue({ children, hint, quiet = false }: { children: ReactNode; hint: string; quiet?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={quiet ? QUIET_TEXT_CLASS : VALUE_CLASS}>{children}</span>
      <span className="text-[12px] font-medium leading-4 text-[#FFFCF6]/45">{hint}</span>
    </span>
  );
}

/** Text as it will be sent, with runs of blank lines folded into one visible line so nothing hides below them. */
function TextValue({ className = VALUE_CLASS, text }: { className?: string; text: string }) {
  if (text === "") return <TypedValue hint="text" quiet>Empty</TypedValue>;
  const normalized = text.replace(/\r\n/gu, "\n");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of normalized.matchAll(BLANK_RUN)) {
    parts.push(
      <VisibleText key={`text-${last}`} text={normalized.slice(last, match.index)} />,
      <span className={cn(MARK_CLASS, "my-1 block w-fit")} key={`blank-${match.index}`}>
        {(match[0].match(/\n/gu)?.length ?? 1) - 1} blank lines
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(<VisibleText key={`text-${last}`} text={normalized.slice(last)} />);
  return <span className={className}>{parts}</span>;
}

/** Shows each invisible character as its code, so bidi and zero-width tricks can't change what the member reads. */
function VisibleText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INVISIBLE)) {
    parts.push(text.slice(last, match.index), (
      <span className={cn(MARK_CLASS, "mx-0.5")} key={match.index}>
        {codePoint(match[0])}
      </span>
    ));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** When Murph asked, on the member's own clock, so it appears once the page is in their browser. */
function AskedAt({ askedAt }: { askedAt: string }) {
  const time = useInBrowser()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(askedAt))
    : null;
  // A blank line holds the space until then.
  return <p className={cn(QUIET_TEXT_CLASS, "px-1 pt-1")}>{time ? `Murph asked at ${time}.` : "\u00a0"}</p>;
}

function outcomeCopy(outcome: CustomConnectionActionOutcome, server: string): { detail: string; title: string } {
  switch (outcome.status) {
    case "done":
      return { detail: `Murph did this in ${server}.`, title: "Done." };
    case "failed":
      return { detail: describeCustomConnectionActionFailure(outcome.reason, server), title: "That didn't go through." };
    case "unknown":
      return { detail: `Check ${server} before trying again.`, title: "This may or may not have happened." };
    case "declined":
      return { detail: `Nothing changed in ${server}.`, title: "You said no." };
    default:
      return { detail: "Ask Murph again.", title: "This request expired." };
  }
}

function OutcomeScreen({
  headingRef,
  outcome,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcome: CustomConnectionActionOutcome;
  request: CustomConnectionActionRequest;
}) {
  const copy = outcomeCopy(outcome, request.server);
  const reply = "text" in outcome ? outcome.text : undefined;
  return (
    <LinkPageScreen
      actions={
        outcome.status === "failed" && FIXED_IN_SETTINGS.has(outcome.reason) ? (
          <Link className={LINK_PAGE_PILL_CLASS} href="/settings/connections">
            Open your MCP servers
          </Link>
        ) : undefined
      }
      below={reply ? <ServerReply server={request.server} text={reply} /> : undefined}
      detail={copy.detail}
      headingRef={headingRef}
      title={copy.title}
    >
      <LinkPagePair joined={outcome.status === "done"} name={request.server} />
    </LinkPageScreen>
  );
}

/** The server's own words about what it did, marked as coming from it. */
function ServerReply({ server, text }: { server: string; text: string }) {
  return (
    <figure className={cn(ROW_CLASS, "mt-4 flex flex-col gap-1")}>
      <figcaption className={QUIET_TEXT_CLASS}>{server} said</figcaption>
      <blockquote className="max-h-48 overflow-y-auto">
        <TextValue className="whitespace-pre-wrap break-words text-[15px] font-medium leading-5" text={text} />
      </blockquote>
    </figure>
  );
}
