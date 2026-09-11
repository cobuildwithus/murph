"use client";

import { useSyncExternalStore } from "react";

const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

export { toFahrenheit } from "@/src/lib/environment/units";

const subscribeToNothing = () => () => undefined;

function readImperial(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return region !== undefined && IMPERIAL_REGIONS.has(region);
  } catch {
    return false;
  }
}

export function useImperialUnits(): boolean {
  return useSyncExternalStore(subscribeToNothing, readImperial, () => false);
}
