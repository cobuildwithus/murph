"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { LinkPagePair } from "@/src/components/link-page/link-page-pair";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
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
// Deeper than this, a value is shown as its raw text rather than indented further.
const NESTED_DEPTH_MAX = 3;
// The member fixes these in Settings before Murph asks again.
const FIXED_IN_SETTINGS = new Set<CustomConnectionActionFailure>(["changed", "off", "signed_out"]);

const subscribeToNothing = () => () => undefined;

/**
 * The member's page for one change Murph asked to make: what it is, exactly what will be sent, and their answer.
 * The page sends only the decision; what runs is the request as it was stored.
 */
export function CustomConnectionConfirm({
  pending: shownPending = null,
  request,
}: {
  /** A pressed button, for the design page. */
  pending?: Decision | null;
  request: CustomConnectionActionRequest;
}) {
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

  async function decide(decision: Decision) {
    setPending(decision);
    setError(null);
    try {
      const result = await requestHostedOnboardingJson<{ outcome: CustomConnectionActionOutcome }>({
        method: "POST",
        payload: { decision },
        url: customConnectionActionUrl(request.id),
      });
      setOutcome(result.outcome);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }

  if (outcome.status === "waiting") {
    return <WaitingScreen decide={decide} error={error} headingRef={headingRef} pending={pending} request={request} />;
  }
  return <OutcomeScreen headingRef={headingRef} outcome={outcome} request={request} />;
}

function place(request: CustomConnectionActionRequest): string {
  return request.host === request.server ? request.server : `${request.server} (${request.host})`;
}

/** The action's own title, asked as a question. */
function question(title: string): string {
  return `${title.trim().replace(/[.!?…]+$/u, "")}?`;
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
      detail={`Murph wants to do this in ${place(request)}.`}
      fill
      headingRef={headingRef}
      title={question(request.title)}
    >
      <ActionInputs inputs={request.inputs ?? {}} />
      <AskedAt askedAt={request.askedAt} />
    </LinkPageScreen>
  );
}

/** Every input, by name, exactly as Murph will send it. */
function ActionInputs({ inputs }: { inputs: Record<string, unknown> }) {
  const entries = Object.entries(inputs);
  if (entries.length === 0) {
    return <p className={cn(ROW_CLASS, QUIET_TEXT_CLASS, "mt-5")}>Murph sends no details with this one.</p>;
  }
  return (
    <dl aria-label="What Murph will send" className="flex flex-col gap-2 pt-5">
      {entries.map(([name, value]) => (
        <div className={cn(ROW_CLASS, "flex flex-col gap-0.5")} key={name}>
          <dt className={cn(QUIET_TEXT_CLASS, "break-words")}>{name}</dt>
          <dd>
            <InputValue depth={0} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One value: nested values indent under their name, and only very deep ones fall back to raw text. */
function InputValue({ depth, value }: { depth: number; value: unknown }) {
  if (value === null || value === "") return <span className={QUIET_TEXT_CLASS}>Nothing</span>;
  if (typeof value !== "object") {
    return <span className={VALUE_CLASS}>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</span>;
  }
  if (depth >= NESTED_DEPTH_MAX) {
    return <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-5">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={QUIET_TEXT_CLASS}>None</span>;
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
  if (entries.length === 0) return <span className={QUIET_TEXT_CLASS}>None</span>;
  return (
    <dl className={NESTED_CLASS}>
      {entries.map(([name, item]) => (
        <div className="flex flex-col" key={name}>
          <dt className={cn(QUIET_TEXT_CLASS, "break-words")}>{name}</dt>
          <dd>
            <InputValue depth={depth + 1} value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** When Murph asked, on the member's own clock, so it appears once the page is in their browser. */
function AskedAt({ askedAt }: { askedAt: string }) {
  const inBrowser = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const time = inBrowser
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(askedAt))
    : null;
  // A blank line holds the space until then.
  return <p className={cn(QUIET_TEXT_CLASS, "px-1 pt-3")}>{time ? `Murph asked at ${time}.` : "\u00a0"}</p>;
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
      <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[15px] font-medium leading-5">
        {text}
      </blockquote>
    </figure>
  );
}
