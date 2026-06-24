"use client";

import { useEffect, useRef, useState } from "react";

interface IntegrationsConnectLauncherProps {
  claim: string;
}

export function IntegrationsConnectLauncher({
  claim,
}: IntegrationsConnectLauncherProps) {
  // Single-use claim: guard against React StrictMode's double-effect so we
  // never fire two POSTs for the same mount (the second would 410).
  const hasFiredRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (hasFiredRef.current) {
      return;
    }
    hasFiredRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/integrations/connect/${encodeURIComponent(claim)}/start`,
          {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            method: "POST",
          },
        );
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setFailed(true);
          return;
        }
        const data = (await response.json()) as { redirectUrl?: unknown };
        if (cancelled) {
          return;
        }
        if (
          typeof data.redirectUrl !== "string"
          || data.redirectUrl.length === 0
        ) {
          setFailed(true);
          return;
        }
        window.location.href = data.redirectUrl;
      } catch {
        if (cancelled) {
          return;
        }
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [claim]);

  if (failed) {
    return (
      <p className="mt-8 max-w-lg text-sm leading-6 text-muted-foreground text-pretty">
        Could not start the connection. Refresh to try again, or ask Murph for a new link.
      </p>
    );
  }

  return (
    <p className="mt-8 max-w-lg text-sm leading-6 text-muted-foreground text-pretty">
      Connecting…
    </p>
  );
}
