"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

type ConnectSource = {
  connectTarget?: string;
  connected?: boolean;
  description: string;
  id: string;
  logo: LogoAsset;
  name: string;
};

export function ConnectSourcesGrid({
  sources,
}: {
  sources: readonly ConnectSource[];
}) {
  const [search, setSearch] = useState("");
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(sources, search),
    [search, sources],
  );

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Sources
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filteredSources.length} of {sources.length} sources
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sources"
          aria-label="Search sources"
          className="w-full sm:w-64"
        />
      </div>

      {filteredSources.length === 0 ? (
        <Alert>
          <AlertTitle>No sources matched</AlertTitle>
          <AlertDescription>
            Try a different search to get back to the full source list.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {filteredSources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </section>
  );
}

export function filterConnectSourcesForSearch(
  sources: readonly ConnectSource[],
  search: string,
): ConnectSource[] {
  const normalizedSearch = search.trim().toLowerCase();

  if (normalizedSearch.length === 0) {
    return [...sources];
  }

  return sources.filter((source) =>
    [source.id, source.name, source.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

function SourceCard({ source }: { source: ConnectSource }) {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isAvailable = Boolean(source.connectTarget);

  async function startConnection() {
    if (!source.connectTarget) {
      return;
    }

    setPending(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/settings/device-sync/providers/${encodeURIComponent(source.connectTarget)}/connect`,
        {
          body: JSON.stringify({ returnTo: "/connect" }),
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      );
      const payload = await response.json() as {
        authorizationUrl?: unknown;
        error?: { message?: unknown };
      };

      if (!response.ok || typeof payload.authorizationUrl !== "string") {
        const message = typeof payload.error?.message === "string"
          ? payload.error.message
          : "Connection could not be started.";
        throw new Error(message);
      }

      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setPending(false);
      setErrorMessage(error instanceof Error ? error.message : "Connection could not be started.");
    }
  }

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-5">
      <div className="absolute top-4 right-4">
        <SourceStatusDot connected={source.connected} sourceName={source.name} />
      </div>

      <div className="mb-5 flex h-14 min-w-0 items-center">
        <SourceLogo source={source} />
      </div>

      <div className="mb-5 min-w-0">
        <h2 className="font-serif text-lg font-semibold text-foreground">
          {source.name}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {source.description}
        </p>
      </div>

      {source.connected ? null : (
        <div className="mt-auto flex flex-col items-start gap-2">
          <Button
            type="button"
            disabled={!isAvailable || pending}
            aria-label={isAvailable
              ? `Connect ${source.name}`
              : `${source.name} connection is not available yet`}
            onClick={startConnection}
          >
            {pending ? "Opening..." : isAvailable ? "Connect" : "Not available"}
          </Button>
          {errorMessage ? (
            <p role="alert" className="text-xs leading-snug text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourceStatusDot({
  connected = false,
  sourceName,
}: {
  connected?: boolean;
  sourceName: string;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        data-connection-state={connected ? "connected" : "idle"}
        className={
          connected
            ? "block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
            : "block size-2.5 rounded-full bg-stone-300 shadow-[0_0_0_3px_rgba(120,113,108,0.12)]"
        }
      />
      <span className="sr-only">
        {sourceName} {connected ? "connected" : "not connected"}
      </span>
    </>
  );
}

function SourceLogo({ source }: { source: ConnectSource }) {
  return (
    <Image
      src={source.logo.src}
      alt=""
      width={source.logo.width}
      height={source.logo.height}
      className={source.logo.className}
    />
  );
}
