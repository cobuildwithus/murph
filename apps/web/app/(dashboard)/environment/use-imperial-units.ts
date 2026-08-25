"use client";

import { useEffect, useState } from "react";

const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

export function toFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function useImperialUnits(): boolean {
  const [imperial, setImperial] = useState(false);
  useEffect(() => {
    try {
      const region = new Intl.Locale(navigator.language).region;
      setImperial(region !== undefined && IMPERIAL_REGIONS.has(region));
    } catch {
      setImperial(false);
    }
  }, []);
  return imperial;
}
