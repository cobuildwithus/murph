"use client";

import * as ReactDOM from "react-dom";

export function HostedPrivyResourceHints({
  origins,
}: {
  origins: readonly string[];
}) {
  for (const origin of origins) {
    ReactDOM.preconnect(origin, { crossOrigin: "anonymous" });
  }

  return null;
}
