"use client";

import { useEffect, useState } from "react";

import {
  formatMessageVolume,
  HOSTED_MESSAGE_VOLUME_FLOOR,
  MESSAGE_VOLUME_ENDPOINT,
} from "@/src/lib/message-volume";

export function MessageVolumeLine() {
  const [total, setTotal] = useState(HOSTED_MESSAGE_VOLUME_FLOOR);

  useEffect(() => {
    let cancelled = false;
    void fetch(MESSAGE_VOLUME_ENDPOINT)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { total?: unknown } | null) => {
        const value = data?.total;
        if (!cancelled && typeof value === "number" && Number.isFinite(value)) {
          setTotal(Math.max(HOSTED_MESSAGE_VOLUME_FLOOR, value));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{formatMessageVolume(total)} messages and counting</>;
}
