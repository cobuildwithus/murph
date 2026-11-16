"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState, type RefObject } from "react";

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
  describeCustomConnectionStatus,
  readCustomConnectionError,
  type CustomConnection,
  type CustomConnectionTool,
} from "./custom-connections-copy";

export const ROW_CLASS = "rounded-[18px] bg-[#2A2622] px-4 py-3.5";
export const QUIET_TEXT_CLASS = "text-sm font-medium leading-[19px] text-[#FFFCF6]/60";

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

/** Everything a screen can read or do; the flow owns the state behind it. */
export interface CustomConnectionsFlowApi {
  actionError: string | null;
  addService: (url: string) => Promise<void>;
  back: () => void;
  connection: CustomConnection | null;
  connections: CustomConnection[];
  draft: Record<string, boolean>;
  go: (next: CustomConnectionsStep) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  leave: () => void;
  openChoose: (target: CustomConnection, mode: "edit" | "new") => void;
  /** Opens a service's screen and asks the service what its actions are now. */
  openService: (target: CustomConnection) => void;
  pending: boolean;
  removeService: (target: CustomConnection) => Promise<void>;
  saveTools: (target: CustomConnection, mode: "edit" | "new") => Promise<void>;
  setStatus: (target: CustomConnection, status: "off" | "on") => Promise<void>;
  setTool: (name: string, on: boolean) => void;
  signInAgain: (target: CustomConnection) => Promise<void>;
  step: CustomConnectionsStep;
  urlId: string;
}

type Flow = CustomConnectionsFlowApi;

/** The line under a service's name on its own screen. */
function describeEditingConnection(connection: CustomConnection): string {
  const changed = connection.tools.filter((tool) => tool.state === "needs_look").length;
  if (connection.status === "off") return "Off. Turn it on to let Murph use it again.";
  if (changed === 1) return "One action changed since you allowed it. Look it over below.";
  if (changed > 1) return "Some actions changed since you allowed them. Look them over below.";
  return `Murph can use ${connection.name} in your private chats and check-ins.`;
}

function needsAttention(connection: CustomConnection): boolean {
  return connection.status === "needs_sign_in" || connection.tools.some((tool) => tool.state === "needs_look");
}

/** The screen for the flow's current step. */
export function CustomConnectionsScreen({ flow }: { flow: Flow }) {
  switch (flow.step.kind) {
    case "loading":
      return <WorkingScreen flow={flow} title="One moment." />;
    case "list":
      return <ListScreen flow={flow} />;
    case "add":
      return <AddScreen error={flow.step.error} flow={flow} url={flow.step.url} />;
    case "checking":
      return <WorkingScreen detail="One moment." flow={flow} title="Checking the link." />;
    case "sign_in":
      return <SignInScreen flow={flow} host={flow.step.authorizationHost} name={flow.step.name} url={flow.step.authorizationUrl} />;
    case "choose":
      return flow.connection ? <ChooseScreen connection={flow.connection} flow={flow} mode={flow.step.mode} /> : null;
    case "connected":
      return <ConnectedScreen flow={flow} />;
    case "remove":
      return flow.connection ? <RemoveScreen connection={flow.connection} flow={flow} /> : null;
    case "failed":
      return <FailedScreen code={flow.step.code} flow={flow} />;
  }
}

function WorkingScreen({ detail, flow, title }: { detail?: string; flow: Flow; title: string }) {
  return (
    <LinkPageScreen detail={detail} headingRef={flow.headingRef} title={title}>
      <LinkPageDots />
    </LinkPageScreen>
  );
}

function ListScreen({ flow }: { flow: Flow }) {
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill onClick={() => flow.go({ error: null, kind: "add", url: "" })}>Add an MCP server</LinkPagePill>
          <LinkPageLink onClick={flow.leave}>Back to settings</LinkPageLink>
        </>
      }
      announceDetail={false}
      detail="Murph can use these in your private chats and check-ins."
      fill
      headingRef={flow.headingRef}
      title="Your MCP servers."
    >
      <ul aria-label="Your MCP servers" className="flex flex-col gap-2 pt-5">
        {flow.connections.map((item) => (
          <li key={item.id}>
            <button
              className={cn(
                ROW_CLASS,
                "flex w-full items-center gap-3 text-left -outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#FFFCF6]/70",
              )}
              onClick={() => flow.openService(item)}
              type="button"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold leading-[22px]">{item.name}</span>
                <span className={cn(QUIET_TEXT_CLASS, needsAttention(item) && "text-[#EBD18B]")}>
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
}

function AddScreen({ error, flow, url }: { error: string | null; flow: Flow; url: string }) {
  const failure = error ? readCustomConnectionError(error) : null;
  const formId = `${flow.urlId}-form`;
  const errorId = `${flow.urlId}-error`;
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill form={formId} type="submit">
            Continue
          </LinkPagePill>
          {flow.connections.length > 0 ? (
            <LinkPageLink onClick={flow.back}>Cancel</LinkPageLink>
          ) : (
            <LinkPageLink onClick={flow.leave}>Back to settings</LinkPageLink>
          )}
        </>
      }
      announceDetail={false}
      below={
        <form
          className="flex flex-col gap-2 pt-[18px]"
          id={formId}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(new FormData(event.currentTarget).get("url") ?? "").trim();
            if (value) void flow.addService(value);
            else flow.go({ error: "invalid_url", kind: "add", url: value });
          }}
          style={LINK_PAGE_NIGHT_TOKENS}
        >
          <label className="sr-only" htmlFor={flow.urlId}>
            MCP server link
          </label>
          <Input
            aria-describedby={failure ? errorId : undefined}
            aria-invalid={failure ? true : undefined}
            autoCapitalize="none"
            autoComplete="off"
            className="h-14 rounded-[18px] border-0 bg-[#2A2622] px-[18px] text-[17px] font-medium text-[#FFFCF6] placeholder:text-[#FFFCF6]/50"
            defaultValue={url}
            id={flow.urlId}
            inputMode="url"
            name="url"
            placeholder="https://"
            spellCheck={false}
            type="url"
          />
          {failure ? (
            <p className="text-[15px] leading-5 text-[#E27B6E]" id={errorId} role="alert">
              {failure.detail}
            </p>
          ) : null}
          <DeveloperNote />
        </form>
      }
      detail="Paste the MCP server's link."
      headingRef={flow.headingRef}
      title="Add an MCP server."
    />
  );
}

function DeveloperNote() {
  return (
    <details className="group">
      <summary
        className={cn(QUIET_TEXT_CLASS, "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden")}
      >
        For developers
        <ChevronDownIcon aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <p className={QUIET_TEXT_CLASS}>
        Paste a remote MCP server URL (Streamable HTTP over HTTPS). If the server offers sign-in, Murph signs in with
        its OAuth, and the server must identify itself in its sign-in response (RFC 9207). Every tool starts off.
        Murph calls tools marked read-only when it needs them; any other tool runs only after you confirm that exact
        call on a Murph page.
      </p>
    </details>
  );
}

function SignInScreen({ flow, host, name, url }: { flow: Flow; host: string; name: string; url: string }) {
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill onClick={() => window.location.assign(url)}>Continue to sign in</LinkPagePill>
          <LinkPageLink onClick={flow.back}>Cancel</LinkPageLink>
        </>
      }
      detail={`You'll sign in at ${host}, then come back here.`}
      headingRef={flow.headingRef}
      title="Sign in to connect it."
    >
      <LinkPagePair name={name} />
    </LinkPageScreen>
  );
}

function ActionError({ flow }: { flow: Flow }) {
  return flow.actionError ? <LinkPageError>{flow.actionError}</LinkPageError> : null;
}

function ChooseScreen({ connection, flow, mode }: { connection: CustomConnection; flow: Flow; mode: "edit" | "new" }) {
  const [details, setDetails] = useState(false);
  const editing = mode === "edit";
  if (editing && connection.status === "needs_sign_in") return <SignedOutScreen connection={connection} flow={flow} />;
  const usable = connection.tools.filter((tool) => tool.state !== "not_allowed");
  if (usable.length === 0) return <NothingUsableScreen connection={connection} flow={flow} />;
  const changed = connection.tools.some((tool) => flow.draft[tool.name] !== (tool.state === "on"));
  const anyOn = Object.values(flow.draft).some(Boolean);
  const saveLabel = editing ? "Save" : `Connect ${connection.name}`;
  const reads = usable.filter((tool) => tool.readOnly);
  const writes = usable.filter((tool) => !tool.readOnly);
  return (
    <LinkPageScreen
      actions={
        <>
          <ActionError flow={flow} />
          <LinkPagePill disabled={flow.pending || !(editing ? changed : anyOn)} onClick={() => void flow.saveTools(connection, mode)}>
            {flow.pending ? "Saving…" : saveLabel}
          </LinkPagePill>
          {editing ? (
            <ManageLinks connection={connection} flow={flow} />
          ) : (
            <LinkPageLink disabled={flow.pending} onClick={() => void flow.removeService(connection)}>
              Cancel
            </LinkPageLink>
          )}
        </>
      }
      announceDetail={false}
      below={editing && connection.host !== connection.name ? <p className={cn(QUIET_TEXT_CLASS, "pt-1.5")}>{connection.host}</p> : undefined}
      detail={editing ? describeEditingConnection(connection) : "Murph asks you before it changes anything."}
      fill
      headingRef={flow.headingRef}
      title={editing ? `${connection.name}.` : "Choose what Murph can use."}
    >
      <button
        aria-pressed={details}
        className={cn(QUIET_TEXT_CLASS, "inline-flex min-h-11 shrink-0 items-center gap-1 self-end px-1 outline-none focus-visible:underline")}
        onClick={() => setDetails(!details)}
        type="button"
      >
        {details ? "Hide details" : "Show details"}
        <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform motion-reduce:transition-none", details && "rotate-180")} />
      </button>
      {reads.length > 0 ? (
        <ul aria-label={`Actions from ${connection.name}`} className="flex flex-col gap-2">
          {reads.map((tool) => (
            <ToolRow details={details} flow={flow} key={tool.name} tool={tool} />
          ))}
        </ul>
      ) : null}
      <AskFirstTools afterReads={reads.length > 0} details={details} flow={flow} tools={writes} />
      <LockedTools tools={connection.tools.filter((tool) => tool.state === "not_allowed")} />
      <p className={cn(QUIET_TEXT_CLASS, "pt-4")}>Described by {connection.name}.</p>
    </LinkPageScreen>
  );
}

/** Actions that change things: each one runs only after the member confirms it on a Murph page. */
function AskFirstTools({ afterReads, details, flow, tools }: { afterReads: boolean; details: boolean; flow: Flow; tools: CustomConnectionTool[] }) {
  const headingId = `${flow.urlId}-ask-first`;
  if (tools.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-2", afterReads && "pt-5")}>
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="text-[15px] font-semibold leading-5" id={headingId}>
          Murph asks you first
        </h2>
        <p className={QUIET_TEXT_CLASS}>Murph sends you a link to confirm each one.</p>
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-2">
        {tools.map((tool) => (
          <ToolRow details={details} flow={flow} key={tool.name} tool={tool} />
        ))}
      </ul>
    </section>
  );
}

/** Actions Murph can't use yet, folded away so the ones it can use come first. */
function LockedTools({ tools }: { tools: CustomConnectionTool[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="group pt-2">
      <summary
        className={cn(
          QUIET_TEXT_CLASS,
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 outline-none focus-visible:underline [&::-webkit-details-marker]:hidden",
        )}
      >
        {tools.length === 1 ? "1 more Murph can't use yet" : `${tools.length} more Murph can't use yet`}
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="flex flex-col gap-2 pb-1">
        {tools.map((tool) => (
          <li className="flex flex-col" key={tool.name}>
            <span className="text-[15px] font-semibold leading-5 text-[#FFFCF6]/60">{tool.title || tool.name}</span>
            <span className={cn(QUIET_TEXT_CLASS, "text-[#FFFCF6]/45")}>Its description is too long to check.</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ManageLinks({ connection, flow }: { connection: CustomConnection; flow: Flow }) {
  const off = connection.status === "off";
  return (
    <span className="flex items-center gap-1">
      <LinkPageLink disabled={flow.pending} onClick={() => void flow.setStatus(connection, off ? "on" : "off")}>
        {off ? "Turn on" : "Turn off"}
      </LinkPageLink>
      <LinkPageLink disabled={flow.pending} onClick={() => flow.go({ connectionId: connection.id, kind: "remove" })}>
        Remove
      </LinkPageLink>
    </span>
  );
}

/** One action: its name, its description when details are shown, and its switch. */
function ToolRow({ details, flow, tool }: { details: boolean; flow: Flow; tool: CustomConnectionTool }) {
  const id = `${flow.urlId}-${tool.name}`;
  return (
    <li>
      <label className={cn(ROW_CLASS, "flex w-full cursor-pointer items-center gap-3")} htmlFor={id}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-pretty text-[17px] font-semibold leading-[22px]">{tool.title || tool.name}</span>
          {details && tool.description ? <span className={QUIET_TEXT_CLASS}>{tool.description}</span> : null}
          {tool.state === "needs_look" ? (
            <span className="text-sm font-semibold leading-[19px] text-[#EBD18B]">
              Changed since you allowed it. Turn it on again if it still looks right.
            </span>
          ) : null}
        </span>
        <Checkbox
          checked={flow.draft[tool.name] ?? false}
          className="size-[26px] shrink-0 rounded-full border-[1.5px] border-[#FFFCF6]/35 data-checked:border-[#FFFCF6] data-checked:bg-[#FFFCF6] data-checked:text-[#2D3436] [&_svg]:size-4"
          disabled={flow.pending}
          id={id}
          onCheckedChange={(checked) => flow.setTool(tool.name, checked === true)}
        />
      </label>
    </li>
  );
}

function SignedOutScreen({ connection, flow }: { connection: CustomConnection; flow: Flow }) {
  return (
    <LinkPageScreen
      actions={
        <>
          <ActionError flow={flow} />
          <LinkPagePill disabled={flow.pending} onClick={() => void flow.signInAgain(connection)}>
            Sign in again
          </LinkPagePill>
          <LinkPageLink disabled={flow.pending} onClick={() => flow.go({ connectionId: connection.id, kind: "remove" })}>
            Remove {connection.name}
          </LinkPageLink>
        </>
      }
      detail={`Murph can't use ${connection.name} until you sign in again.`}
      headingRef={flow.headingRef}
      title={`${connection.name} signed you out.`}
    >
      <LinkPagePair name={connection.name} />
    </LinkPageScreen>
  );
}

function NothingUsableScreen({ connection, flow }: { connection: CustomConnection; flow: Flow }) {
  return (
    <LinkPageScreen
      actions={
        <>
          <ActionError flow={flow} />
          <LinkPagePill disabled={flow.pending} onClick={() => void flow.removeService(connection)}>
            Remove {connection.name}
          </LinkPagePill>
        </>
      }
      detail="This MCP server doesn't offer anything Murph can use yet."
      headingRef={flow.headingRef}
      title="Nothing here Murph can use."
    />
  );
}

function ConnectedScreen({ flow }: { flow: Flow }) {
  const name = flow.connection?.name ?? "Your MCP server";
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={() => flow.go({ kind: "list" })}>Done</LinkPagePill>}
      detail="Murph can use it in your private chats and check-ins."
      headingRef={flow.headingRef}
      title={`${name} is connected.`}
    >
      <LinkPagePair joined name={name} />
    </LinkPageScreen>
  );
}

function RemoveScreen({ connection, flow }: { connection: CustomConnection; flow: Flow }) {
  return (
    <LinkPageScreen
      actions={
        <>
          <ActionError flow={flow} />
          <LinkPagePill disabled={flow.pending} onClick={() => void flow.removeService(connection)}>
            {flow.pending ? "Removing…" : "Remove"}
          </LinkPagePill>
          <LinkPageLink disabled={flow.pending} onClick={() => flow.openChoose(connection, "edit")}>
            Keep it
          </LinkPageLink>
        </>
      }
      detail="Murph will stop using it and sign out of it."
      headingRef={flow.headingRef}
      title={`Remove ${connection.name}?`}
    />
  );
}

function FailedScreen({ code, flow }: { code: string | null; flow: Flow }) {
  const failure = readCustomConnectionError(code);
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill onClick={() => flow.go({ error: null, kind: "add", url: "" })}>Start again</LinkPagePill>
          <LinkPageLink onClick={flow.leave}>Back to settings</LinkPageLink>
        </>
      }
      detail={failure.detail}
      headingRef={flow.headingRef}
      title={failure.title}
    />
  );
}
