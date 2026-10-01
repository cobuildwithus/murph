"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/src/lib/utils";

export function FoodBrandVisual(input: {
  asset: string;
  brand: string | null;
  brandfetchClientId?: string | null;
  className?: string;
  searchContext?: string | null;
  size?: "sm" | "md";
}) {
  const hue = useMemo(
    () => getFoodBrandHue(input.brand, input.asset),
    [input.brand, input.asset],
  );
  const searchUrl = useMemo(
    () =>
      buildFoodBrandSearchUrl(
        input.brand,
        input.searchContext,
        input.brandfetchClientId,
      ),
    [input.brand, input.brandfetchClientId, input.searchContext],
  );
  const [resolvedLogo, setResolvedLogo] = useState<{
    searchUrl: string;
    url: string;
  } | null>(null);
  const [failedSearchUrl, setFailedSearchUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!searchUrl || !input.brand) {
      return;
    }

    void requestFoodBrandLogo(searchUrl, input.brand).then((resolvedUrl) => {
      if (active && resolvedUrl) {
        setResolvedLogo({ searchUrl, url: resolvedUrl });
      }
    });

    return () => {
      active = false;
    };
  }, [input.brand, searchUrl]);

  const size = input.size ?? "md";
  const accent = `oklch(0.56 0.12 ${hue})`;
  const visibleLogoUrl =
    resolvedLogo?.searchUrl === searchUrl && failedSearchUrl !== searchUrl
      ? resolvedLogo.url
      : null;
  const hasLogo = visibleLogoUrl !== null;

  return (
    <span
      aria-hidden="true"
      data-food-brand-visual={hasLogo ? "logo" : "illustration"}
      className={cn(
        "relative isolate flex shrink-0 items-center justify-center overflow-hidden rounded-xl border",
        size === "sm" ? "size-10" : "size-14",
        input.className,
      )}
      style={{
        backgroundColor: hasLogo
          ? "transparent"
          : `color-mix(in oklch, ${accent} 11%, var(--card))`,
        borderColor: hasLogo
          ? "transparent"
          : `color-mix(in oklch, ${accent} 30%, var(--border))`,
      }}
    >
      {hasLogo ? (
        <Image
          src={visibleLogoUrl}
          alt=""
          width={size === "sm" ? 40 : 56}
          height={size === "sm" ? 40 : 56}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedSearchUrl(searchUrl)}
          className="size-full object-contain"
        />
      ) : (
        <Image
          src={input.asset}
          alt=""
          width={size === "sm" ? 40 : 56}
          height={size === "sm" ? 40 : 56}
          className={cn(
            "size-full object-contain",
            size === "sm" ? "p-0.5" : "p-1",
          )}
        />
      )}
      {hasLogo ? null : (
        <span
          className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
      )}
    </span>
  );
}

export function getFoodBrandHue(brand: string | null, asset: string): number {
  return deriveBrandHue(normalizeBrandKey(brand) || asset);
}

const foodBrandLogoRequests = new Map<string, Promise<string | null>>();

export function buildFoodBrandSearchUrl(
  brand: string | null,
  searchContext: string | null | undefined,
  clientId: string | null | undefined,
): string | null {
  const normalizedBrand = brand?.trim();
  const normalizedClientId = clientId?.trim();
  if (
    !normalizedBrand ||
    !normalizedClientId ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(normalizedClientId)
  ) {
    return null;
  }

  const normalizedContext = searchContext?.trim().slice(0, 80) || "food";
  const searchUrl = new URL(
    `https://api.brandfetch.io/v2/search/${encodeURIComponent(
      `${normalizedBrand} ${normalizedContext}`,
    )}`,
  );
  searchUrl.searchParams.set("c", normalizedClientId);
  return searchUrl.toString();
}

export function selectFoodBrandLogoUrl(
  payload: unknown,
  brand: string,
): string | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const brandKey = normalizeBrandText(brand);
  if (!brandKey) {
    return null;
  }

  for (const candidate of payload) {
    if (!isBrandfetchSearchResult(candidate)) {
      continue;
    }
    const candidateKey = normalizeBrandText(candidate.name);
    if (!containsBrandName(candidateKey, brandKey)) {
      continue;
    }
    const iconUrl = parseBrandfetchIconUrl(candidate.icon);
    if (iconUrl) {
      return iconUrl;
    }
  }

  return null;
}

function normalizeBrandKey(brand: string | null): string {
  return brand?.trim().toLocaleLowerCase("en-US").slice(0, 96) ?? "";
}

function normalizeBrandText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function containsBrandName(candidate: string, brand: string): boolean {
  return ` ${candidate} `.includes(` ${brand} `);
}

function isBrandfetchSearchResult(
  value: unknown,
): value is { icon: string; name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "icon" in value &&
    typeof value.icon === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function parseBrandfetchIconUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.brandfetch.io"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function requestFoodBrandLogo(
  searchUrl: string,
  brand: string,
): Promise<string | null> {
  const cached = foodBrandLogoRequests.get(searchUrl);
  if (cached) {
    return cached;
  }

  const request = fetch(searchUrl, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const payload: unknown = await response.json();
      return selectFoodBrandLogoUrl(payload, brand);
    })
    .catch(() => null);
  foodBrandLogoRequests.set(searchUrl, request);
  return request;
}

function deriveBrandHue(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return normalizeHue(hash);
}

function normalizeHue(value: number): number {
  return Math.round(((value % 360) + 360) % 360);
}
