"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

import {
  CUSTOM_CONNECTIONS_API,
  readCustomConnectionError,
  type CustomConnection,
  type CustomConnectionAddResult,
} from "./custom-connections-copy";
import {
  CustomConnectionsScreen,
  type CustomConnectionsFlowApi,
  type CustomConnectionsStep,
} from "./custom-connections-screens";

export type { CustomConnectionsStep } from "./custom-connections-screens";

export interface CustomConnectionsFlowProps {
  /** A fixed screen with sample data, for the design page. Nothing is loaded or saved. */
  fixture?: { connections: CustomConnection[]; draft?: Record<string, boolean>; step: CustomConnectionsStep };
  /** Set when sign-in sends the member back here. */
  returned?: { connectionId: string | null; error: string | null; step: string | null };
}

const CHANGED_SINCE_OPENED = "This service changed since you opened it. Look it over again.";

function errorCode(error: unknown): string | null {
  return error instanceof HostedOnboardingApiError ? error.code ?? null : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function connectionUrl(id: string, suffix = ""): string {
  return `${CUSTOM_CONNECTIONS_API}/${encodeURIComponent(id)}${suffix}`;
}

async function loadConnections(): Promise<CustomConnection[]> {
  return (await requestHostedOnboardingJson<{ connections: CustomConnection[] }>({ url: CUSTOM_CONNECTIONS_API })).connections;
}

function toolDraft(connection: CustomConnection): Record<string, boolean> {
  return Object.fromEntries(connection.tools.map((tool) => [tool.name, tool.state === "on"]));
}

function startingDraft(fixture: CustomConnectionsFlowProps["fixture"]): Record<string, boolean> {
  if (!fixture) return {};
  if (fixture.draft) return fixture.draft;
  const step = fixture.step;
  const shown = "connectionId" in step ? fixture.connections.find((item) => item.id === step.connectionId) : undefined;
  return shown ? toolDraft(shown) : {};
}

/** Every screen for adding and looking after the services Murph can use. */
export function CustomConnectionsFlow({ fixture, returned }: CustomConnectionsFlowProps) {
  const [step, setStep] = useState<CustomConnectionsStep>(fixture?.step ?? { kind: "loading" });
  const [connections, setConnections] = useState<CustomConnection[]>(fixture?.connections ?? []);
  const [draft, setDraft] = useState<Record<string, boolean>>(() => startingDraft(fixture));
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const urlId = useId();
  const router = useRouter();

  const go = useCallback((next: CustomConnectionsStep) => {
    setActionError(null);
    setPending(false);
    setStep(next);
  }, []);

  const home = useCallback(
    (list: CustomConnection[]): CustomConnectionsStep => (list.length === 0 ? { error: null, kind: "add", url: "" } : { kind: "list" }),
    [],
  );

  const openChoose = useCallback(
    (target: CustomConnection, mode: "edit" | "new") => {
      setDraft(toolDraft(target));
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
    loadConnections()
      .then((loaded) => {
        if (cancelled) return;
        setConnections(loaded);
        const back = loaded.find((item) => item.id === returnedConnectionId);
        if (returnedError) go({ code: returnedError, kind: "failed" });
        else if (back && returnedStep === "choose") openChoose(back, "new");
        else go(home(loaded));
      })
      .catch((error: unknown) => {
        if (!cancelled) go({ code: errorCode(error), kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, go, home, openChoose, returnedConnectionId, returnedError, returnedStep]);

  // Screen readers and keyboards start each screen at its headline.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step.kind]);

  const remember = (updated: CustomConnection) => {
    setConnections((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
  };

  /** Runs one Settings change; a change made elsewhere in between reloads the service instead. */
  async function mutate(target: CustomConnection, mode: "edit" | "new", work: () => Promise<void>) {
    setPending(true);
    setActionError(null);
    try {
      await work();
    } catch (error) {
      if (errorCode(error) === "conflict") {
        await reloadAfterChange(target.id, mode);
        return;
      }
      setPending(false);
      setActionError(readCustomConnectionError(errorCode(error)).detail);
    }
  }

  async function reloadAfterChange(id: string, mode: "edit" | "new") {
    try {
      const loaded = await loadConnections();
      setConnections(loaded);
      const fresh = loaded.find((item) => item.id === id);
      if (!fresh) {
        go(home(loaded));
        return;
      }
      openChoose(fresh, mode);
      setActionError(CHANGED_SINCE_OPENED);
    } catch (error) {
      go({ code: errorCode(error), kind: "failed" });
    }
  }

  async function patch(target: CustomConnection, payload: Record<string, unknown>): Promise<CustomConnection> {
    const { connection: saved } = await requestHostedOnboardingJson<{ connection: CustomConnection }>({
      method: "PATCH",
      payload: { revision: target.revision, ...payload },
      url: connectionUrl(target.id),
    });
    remember(saved);
    return saved;
  }

  const flow: CustomConnectionsFlowApi = {
    actionError,
    connection: "connectionId" in step ? connections.find((item) => item.id === step.connectionId) ?? null : null,
    connections,
    draft,
    headingRef,
    pending,
    step,
    urlId,
    go,
    openChoose,
    back: () => go(home(connections)),
    leave: () => router.push("/settings"),
    setTool: (name, on) => setDraft((current) => ({ ...current, [name]: on })),
    async addService(url) {
      go({ kind: "checking", url });
      try {
        const result = await requestHostedOnboardingJson<CustomConnectionAddResult>({ method: "POST", payload: { url }, url: CUSTOM_CONNECTIONS_API });
        if (result.next === "sign_in") {
          go({ authorizationHost: result.authorizationHost, authorizationUrl: result.authorizationUrl, kind: "sign_in", name: hostOf(url) });
          return;
        }
        remember(result.connection);
        openChoose(result.connection, "new");
      } catch (error) {
        go({ error: errorCode(error) ?? "unknown", kind: "add", url });
      }
    },
    saveTools: (target, mode) =>
      mutate(target, mode, async () => {
        // Connecting a new service turns it on with the chosen actions.
        const saved = await patch(target, mode === "new" ? { status: "on", tools: draft } : { tools: draft });
        if (mode === "new") go({ connectionId: saved.id, kind: "connected" });
        else openChoose(saved, "edit");
      }),
    setStatus: (target, status) =>
      mutate(target, "edit", async () => {
        openChoose(await patch(target, { status }), "edit");
      }),
    signInAgain: (target) =>
      mutate(target, "edit", async () => {
        const result = await requestHostedOnboardingJson<{ authorizationHost: string; authorizationUrl: string }>({
          method: "POST",
          url: connectionUrl(target.id, "/sign-in"),
        });
        go({ ...result, kind: "sign_in", name: target.name });
      }),
    removeService: (target) =>
      mutate(target, "edit", async () => {
        await requestHostedOnboardingJson<unknown>({ method: "DELETE", url: connectionUrl(target.id) });
        const left = connections.filter((item) => item.id !== target.id);
        setConnections(left);
        go(home(left));
      }),
  };

  return <CustomConnectionsScreen flow={flow} />;
}
