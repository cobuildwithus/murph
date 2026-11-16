"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import { LinkPagePair } from "@/src/components/link-page/link-page-pair";
import {
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Input } from "@/src/components/ui/input";
import { cn } from "@/src/lib/utils";

import {
  CUSTOM_CONNECTIONS_API,
  describeCustomConnectionStatus,
  readCustomConnectionError,
  type CustomConnection,
  type CustomConnectionAddResult,
} from "./custom-connections-copy";

const ROW_CLASS = "rounded-[18px] bg-[#2A2622] px-4 py-3.5";
const QUIET_TEXT_CLASS = "text-sm font-medium leading-[19px] text-[#FFFCF6]/60";

export type CustomConnectionsStep =
  | { kind: "loading" }
  | { kind: "list" }
  | { kind: "add"; error: string | null; url: string }
  | { kind: "checking"; url: string }
  | { authorizationHost: string; authorizationUrl: string; kind: "sign_in"; name: string }
  | { connectionId: string; kind: "choose"; mode: "edit" | "new" }
  | { connectionId: string; kind: "connected" }
  | { connectionId: string; kind: "remove" }
  | { code: string | null; kind: "failed" };

type Step = CustomConnectionsStep;

export interface CustomConnectionsFlowProps {
  /** A fixed screen with sample data, for the design page. Nothing is loaded or saved. */
  fixture?: { connections: CustomConnection[]; draft?: Record<string, boolean>; step: CustomConnectionsStep };
  /** Set when sign-in sends the member back here. */
  returned?: { connectionId: string | null; error: string | null; step: string | null };
}

function errorCode(error: unknown): string | null {
  return error instanceof HostedOnboardingApiError ? error.code ?? null : null;
}

/** The line under a service's name on its own screen. */
function describeEditingConnection(connection: CustomConnection): string {
  const changed = connection.tools.filter((tool) => tool.state === "needs_look").length;
  if (connection.status === "off") return "Off. Turn it on to let Murph use it again.";
  if (changed === 1) return "One action changed since you allowed it. Look it over below.";
  if (changed > 1) return "Some actions changed since you allowed them. Look them over below.";
  return `Murph can look things up with ${connection.name} in your private chats and check-ins.`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Every screen for adding and looking after the services Murph can use. */
export function CustomConnectionsFlow({ fixture, returned }: CustomConnectionsFlowProps) {
  const [step, setStep] = useState<Step>(fixture?.step ?? { kind: "loading" });
  const [connections, setConnections] = useState<CustomConnection[]>(fixture?.connections ?? []);
  const [draft, setDraft] = useState<Record<string, boolean>>(() => {
    if (fixture?.draft) return fixture.draft;
    const shown = fixture && "connectionId" in fixture.step
      ? fixture.connections.find((item) => item.id === (fixture.step as { connectionId: string }).connectionId)
      : null;
    return shown ? Object.fromEntries(shown.tools.map((tool) => [tool.name, tool.state === "on"])) : {};
  });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const urlId = useId();
  const router = useRouter();

  const connection = "connectionId" in step ? connections.find((item) => item.id === step.connectionId) ?? null : null;

  const go = useCallback((next: Step) => {
    setActionError(null);
    setPending(false);
    setStep(next);
  }, []);

  const remember = useCallback((updated: CustomConnection) => {
    setConnections((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
  }, []);

  const openChoose = useCallback(
    (target: CustomConnection, mode: "edit" | "new") => {
      setDraft(Object.fromEntries(target.tools.map((tool) => [tool.name, tool.state === "on"])));
      go({ connectionId: target.id, kind: "choose", mode });
    },
    [go],
  );

  const returnedConnectionId = returned?.connectionId ?? null;
  const returnedError = returned?.error ?? null;
  const returnedStep = returned?.step ?? null;

  // Load the member's services, then pick up where sign-in left off.
  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    requestHostedOnboardingJson<{ connections: CustomConnection[] }>({ url: CUSTOM_CONNECTIONS_API })
      .then(({ connections: loaded }) => {
        if (cancelled) return;
        setConnections(loaded);
        if (returnedError) {
          go({ code: returnedError, kind: "failed" });
          return;
        }
        const back = returnedConnectionId ? loaded.find((item) => item.id === returnedConnectionId) : null;
        if (back && returnedStep === "choose") {
          openChoose(back, "new");
          return;
        }
        go(loaded.length === 0 ? { error: null, kind: "add", url: "" } : { kind: "list" });
      })
      .catch((error: unknown) => {
        if (!cancelled) go({ code: errorCode(error), kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, go, openChoose, returnedConnectionId, returnedError, returnedStep]);

  // Screen readers and keyboards start each screen at its headline.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step.kind]);

  async function addService(url: string) {
    go({ kind: "checking", url });
    try {
      const result = await requestHostedOnboardingJson<CustomConnectionAddResult>({
        method: "POST",
        payload: { url },
        url: CUSTOM_CONNECTIONS_API,
      });
      if (result.next === "sign_in") {
        go({
          authorizationHost: result.authorizationHost,
          authorizationUrl: result.authorizationUrl,
          kind: "sign_in",
          name: hostOf(url),
        });
        return;
      }
      remember(result.connection);
      openChoose(result.connection, "new");
    } catch (error) {
      go({ error: errorCode(error) ?? "unknown", kind: "add", url });
    }
  }

  async function saveTools(target: CustomConnection, mode: "edit" | "new") {
    setPending(true);
    setActionError(null);
    try {
      const { connection: saved } = await requestHostedOnboardingJson<{ connection: CustomConnection }>({
        method: "PATCH",
        // Connecting a new service turns it on with the chosen actions.
        payload: mode === "new" ? { status: "on", tools: draft } : { tools: draft },
        url: `${CUSTOM_CONNECTIONS_API}/${encodeURIComponent(target.id)}`,
      });
      remember(saved);
      if (mode === "new") go({ connectionId: saved.id, kind: "connected" });
      else openChoose(saved, "edit");
    } catch (error) {
      setPending(false);
      setActionError(readCustomConnectionError(errorCode(error)).detail);
    }
  }

  async function setStatus(target: CustomConnection, status: "off" | "on") {
    setPending(true);
    setActionError(null);
    try {
      const { connection: saved } = await requestHostedOnboardingJson<{ connection: CustomConnection }>({
        method: "PATCH",
        payload: { status },
        url: `${CUSTOM_CONNECTIONS_API}/${encodeURIComponent(target.id)}`,
      });
      remember(saved);
      openChoose(saved, "edit");
    } catch (error) {
      setPending(false);
      setActionError(readCustomConnectionError(errorCode(error)).detail);
    }
  }

  async function signInAgain(target: CustomConnection) {
    setPending(true);
    setActionError(null);
    try {
      const result = await requestHostedOnboardingJson<{ authorizationHost: string; authorizationUrl: string }>({
        method: "POST",
        url: `${CUSTOM_CONNECTIONS_API}/${encodeURIComponent(target.id)}/sign-in`,
      });
      go({ ...result, kind: "sign_in", name: target.name });
    } catch (error) {
      setPending(false);
      setActionError(readCustomConnectionError(errorCode(error)).detail);
    }
  }

  async function removeService(target: CustomConnection) {
    setPending(true);
    setActionError(null);
    try {
      await requestHostedOnboardingJson<unknown>({
        method: "DELETE",
        url: `${CUSTOM_CONNECTIONS_API}/${encodeURIComponent(target.id)}`,
      });
      const left = connections.filter((item) => item.id !== target.id);
      setConnections(left);
      go(left.length === 0 ? { error: null, kind: "add", url: "" } : { kind: "list" });
    } catch (error) {
      setPending(false);
      setActionError(readCustomConnectionError(errorCode(error)).detail);
    }
  }

  const back = () => go(connections.length === 0 ? { error: null, kind: "add", url: "" } : { kind: "list" });

  switch (step.kind) {
    case "loading":
      return (
        <LinkPageScreen headingRef={headingRef} title="One moment.">
          <LinkPageDots />
        </LinkPageScreen>
      );

    case "list":
      return (
        <LinkPageScreen
          actions={
            <>
              <LinkPagePill onClick={() => go({ error: null, kind: "add", url: "" })}>Add a service</LinkPagePill>
              <LinkPageLink onClick={() => router.push("/settings")}>Back to settings</LinkPageLink>
            </>
          }
          announceDetail={false}
          detail="Murph can look things up in these in your private chats and check-ins."
          fill
          headingRef={headingRef}
          title="Your services."
        >
          <ul aria-label="Your services" className="flex flex-col gap-2 pt-5">
            {connections.map((item) => (
              <li key={item.id}>
                <button
                  className={cn(
                    ROW_CLASS,
                    "flex w-full items-center gap-3 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#FFFCF6]/70",
                  )}
                  onClick={() => openChoose(item, "edit")}
                  type="button"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[17px] font-semibold leading-[22px]">{item.name}</span>
                    <span
                      className={cn(
                        QUIET_TEXT_CLASS,
                        (item.status === "needs_sign_in" || item.tools.some((tool) => tool.state === "needs_look")) &&
                          "text-[#EBD18B]",
                      )}
                    >
                      {describeCustomConnectionStatus(item)}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-[#FFFCF6]/40" />
                </button>
              </li>
            ))}
          </ul>
        </LinkPageScreen>
      );

    case "add": {
      const failure = step.error ? readCustomConnectionError(step.error) : null;
      return (
        <LinkPageScreen
          actions={
            <>
              <LinkPagePill form={`${urlId}-form`} type="submit">
                Continue
              </LinkPagePill>
              {connections.length > 0 ? <LinkPageLink onClick={back}>Cancel</LinkPageLink> : (
                <LinkPageLink onClick={() => router.push("/settings")}>Back to settings</LinkPageLink>
              )}
            </>
          }
          announceDetail={false}
          below={
            <form
              className="flex flex-col gap-2 pt-[18px]"
              id={`${urlId}-form`}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const value = String(new FormData(event.currentTarget).get("url") ?? "").trim();
                if (!value) {
                  go({ error: "invalid_url", kind: "add", url: value });
                  return;
                }
                void addService(value);
              }}
              style={LINK_PAGE_NIGHT_TOKENS}
            >
              <label className="sr-only" htmlFor={urlId}>
                Service link
              </label>
              <Input
                aria-describedby={failure ? `${urlId}-error` : undefined}
                aria-invalid={failure ? true : undefined}
                autoCapitalize="none"
                autoComplete="off"
                className="h-14 rounded-[18px] border-0 bg-[#2A2622] px-[18px] text-[17px] font-medium text-[#FFFCF6] placeholder:text-[#FFFCF6]/50"
                defaultValue={step.url}
                id={urlId}
                inputMode="url"
                name="url"
                placeholder="https://"
                spellCheck={false}
                type="url"
              />
              {failure ? (
                <p className="text-[15px] leading-5 text-[#E27B6E]" id={`${urlId}-error`} role="alert">
                  {failure.detail}
                </p>
              ) : null}
              <details className="group">
                <summary
                  className={cn(
                    QUIET_TEXT_CLASS,
                    "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden",
                  )}
                >
                  For developers
                  <ChevronDownIcon aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <p className={QUIET_TEXT_CLASS}>
                  Paste a remote MCP server URL (Streamable HTTP over HTTPS). If it needs sign-in, Murph uses the
                  server&apos;s OAuth. Murph lists only tools marked read-only, and each starts off.
                </p>
              </details>
            </form>
          }
          detail="Paste the link the service gave you."
          headingRef={headingRef}
          title="Add a service."
        />
      );
    }

    case "checking":
      return (
        <LinkPageScreen detail="One moment." headingRef={headingRef} title="Checking the link.">
          <LinkPageDots />
        </LinkPageScreen>
      );

    case "sign_in":
      return (
        <LinkPageScreen
          actions={
            <>
              <LinkPagePill onClick={() => window.location.assign(step.authorizationUrl)}>
                Continue to sign in
              </LinkPagePill>
              <LinkPageLink onClick={back}>Cancel</LinkPageLink>
            </>
          }
          detail={`You'll sign in at ${step.authorizationHost}, then come back here.`}
          headingRef={headingRef}
          title="Sign in to connect it."
        >
          <LinkPagePair name={step.name} />
        </LinkPageScreen>
      );

    case "choose": {
      if (!connection) return null;
      const editing = step.mode === "edit";
      const usable = connection.tools.filter((tool) => tool.state !== "not_allowed");
      const changed = connection.tools.some((tool) => draft[tool.name] !== (tool.state === "on"));
      const anyOn = Object.values(draft).some(Boolean);

      if (editing && connection.status === "needs_sign_in") {
        return (
          <LinkPageScreen
            actions={
              <>
                {actionError ? <LinkPageError>{actionError}</LinkPageError> : null}
                <LinkPagePill disabled={pending} onClick={() => void signInAgain(connection)}>
                  Sign in again
                </LinkPagePill>
                <LinkPageLink disabled={pending} onClick={() => go({ connectionId: connection.id, kind: "remove" })}>
                  Remove {connection.name}
                </LinkPageLink>
              </>
            }
            detail={`Murph can't use ${connection.name} until you sign in again.`}
            headingRef={headingRef}
            title={`${connection.name} signed you out.`}
          >
            <LinkPagePair name={connection.name} />
          </LinkPageScreen>
        );
      }

      if (usable.length === 0) {
        return (
          <LinkPageScreen
            actions={
              <>
                {actionError ? <LinkPageError>{actionError}</LinkPageError> : null}
                <LinkPagePill disabled={pending} onClick={() => void removeService(connection)}>
                  Remove {connection.name}
                </LinkPagePill>
              </>
            }
            detail="Murph can only look things up for now, and this service doesn't offer that yet."
            headingRef={headingRef}
            title={`Nothing here Murph can use.`}
          />
        );
      }

      return (
        <LinkPageScreen
          actions={
            <>
              {actionError ? <LinkPageError>{actionError}</LinkPageError> : null}
              <LinkPagePill
                disabled={pending || (editing ? !changed : !anyOn)}
                onClick={() => void saveTools(connection, step.mode)}
              >
                {pending ? "Saving…" : editing ? "Save" : `Connect ${connection.name}`}
              </LinkPagePill>
              {editing ? (
                <span className="flex items-center gap-1">
                  <LinkPageLink
                    disabled={pending}
                    onClick={() => void setStatus(connection, connection.status === "off" ? "on" : "off")}
                  >
                    {connection.status === "off" ? "Turn on" : "Turn off"}
                  </LinkPageLink>
                  <LinkPageLink disabled={pending} onClick={() => go({ connectionId: connection.id, kind: "remove" })}>
                    Remove
                  </LinkPageLink>
                </span>
              ) : (
                <LinkPageLink disabled={pending} onClick={() => void removeService(connection)}>
                  Cancel
                </LinkPageLink>
              )}
            </>
          }
          announceDetail={false}
          below={
            editing && connection.host !== connection.name ? (
              <p className={cn(QUIET_TEXT_CLASS, "pt-1.5")}>{connection.host}</p>
            ) : undefined
          }
          detail={editing ? describeEditingConnection(connection) : `Murph can only look things up with ${connection.name} for now.`}
          fill
          headingRef={headingRef}
          title={editing ? `${connection.name}.` : "Choose what Murph can use."}
        >
          <ul aria-label={`Actions from ${connection.name}`} className="flex flex-col gap-2 pt-5">
            {connection.tools.map((tool) => {
              const id = `${urlId}-${tool.name}`;
              const blocked = tool.state === "not_allowed";
              return (
                <li key={tool.name}>
                  <label
                    className={cn(ROW_CLASS, "flex w-full items-center gap-3", blocked ? "opacity-50" : "cursor-pointer")}
                    htmlFor={id}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-pretty text-[17px] font-semibold leading-[22px]">{tool.title || tool.name}</span>
                      <span className={cn(QUIET_TEXT_CLASS, "line-clamp-3")}>{tool.description}</span>
                      {tool.state === "needs_look" ? (
                        <span className="text-sm font-semibold leading-[19px] text-[#EBD18B]">
                          Changed since you allowed it. Turn it on again if it still looks right.
                        </span>
                      ) : null}
                      {blocked ? (
                        <span className={QUIET_TEXT_CLASS}>Murph can&apos;t use this yet: it may change things.</span>
                      ) : null}
                    </span>
                    <Checkbox
                      checked={draft[tool.name] ?? false}
                      className="size-[26px] rounded-full border-[1.5px] border-[#FFFCF6]/35 data-checked:border-[#FFFCF6] data-checked:bg-[#FFFCF6] data-checked:text-[#2D3436] [&_svg]:size-4"
                      disabled={blocked || pending}
                      id={id}
                      onCheckedChange={(checked) => setDraft((current) => ({ ...current, [tool.name]: checked === true }))}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className={cn(QUIET_TEXT_CLASS, "pt-4")}>Described by {connection.name}.</p>
        </LinkPageScreen>
      );
    }

    case "connected":
      return (
        <LinkPageScreen
          actions={<LinkPagePill onClick={() => go({ kind: "list" })}>Done</LinkPagePill>}
          detail="Murph can use it in your private chats and check-ins."
          headingRef={headingRef}
          title={`${connection?.name ?? "Your service"} is connected.`}
        >
          <LinkPagePair joined name={connection?.name ?? "?"} />
        </LinkPageScreen>
      );

    case "remove":
      if (!connection) return null;
      return (
        <LinkPageScreen
          actions={
            <>
              {actionError ? <LinkPageError>{actionError}</LinkPageError> : null}
              <LinkPagePill disabled={pending} onClick={() => void removeService(connection)}>
                {pending ? "Removing…" : "Remove"}
              </LinkPagePill>
              <LinkPageLink disabled={pending} onClick={() => openChoose(connection, "edit")}>
                Keep it
              </LinkPageLink>
            </>
          }
          detail="Murph will stop using it and sign out of it."
          headingRef={headingRef}
          title={`Remove ${connection.name}?`}
        />
      );

    case "failed": {
      const failure = readCustomConnectionError(step.code);
      return (
        <LinkPageScreen
          actions={
            <>
              <LinkPagePill onClick={() => go({ error: null, kind: "add", url: "" })}>Start again</LinkPagePill>
              <LinkPageLink onClick={() => router.push("/settings")}>Back to settings</LinkPageLink>
            </>
          }
          detail={failure.detail}
          headingRef={headingRef}
          title={failure.title}
        />
      );
    }
  }
}
