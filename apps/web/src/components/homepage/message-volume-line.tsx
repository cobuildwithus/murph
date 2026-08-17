"use client";

import { useEffect, useState } from "react";

import {
  formatMessageVolume,
  HOSTED_MESSAGE_VOLUME_BASE,
  MESSAGE_VOLUME_ENDPOINT,
} from "@/src/lib/message-volume";

export function useMessageVolumeTotal({
  enabled = true,
}: {
  enabled?: boolean;
} = {}): number {
  const [total, setTotal] = useState(HOSTED_MESSAGE_VOLUME_BASE);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void fetch(MESSAGE_VOLUME_ENDPOINT)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { total?: unknown } | null) => {
        const value = data?.total;
        if (!cancelled && typeof value === "number" && Number.isFinite(value)) {
          setTotal(Math.max(HOSTED_MESSAGE_VOLUME_BASE, value));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled ? total : HOSTED_MESSAGE_VOLUME_BASE;
}

export function MessageVolumeCount({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const total = useMessageVolumeTotal({ enabled });

  return <>{formatMessageVolume(total)}</>;
}

export function MessageVolumeLine() {
  return (
    <>
      <MessageVolumeCount /> messages and counting
    </>
  );
}
