import type { Prisma } from "@prisma/client";
import type { SharePack } from "@murphai/contracts";

import type { HostedShareKind, HostedSharePreview } from "./types";

export function createHostedShareMinimalPreview(): HostedSharePreview {
  return {
    kinds: [],
    counts: {
      foods: 0,
      protocols: 0,
      recipes: 0,
      total: 0,
    },
    logMealAfterImport: false,
  };
}

export function buildHostedSharePreview(pack: SharePack): HostedSharePreview {
  const kinds = new Set<HostedShareKind>();
  let foods = 0;
  let protocols = 0;
  let recipes = 0;

  for (const entity of pack.entities) {
    if (entity.kind === "food") {
      foods += 1;
      kinds.add("food");
      continue;
    }

    if (entity.kind === "protocol") {
      protocols += 1;
      kinds.add("protocol");
      continue;
    }

    recipes += 1;
    kinds.add("recipe");
  }

  return {
    kinds: [...kinds].sort(),
    counts: {
      foods,
      protocols,
      recipes,
      total: pack.entities.length,
    },
    logMealAfterImport: Boolean(pack.afterImport?.logMeal),
  };
}

export function serializeHostedSharePreview(preview: HostedSharePreview): Prisma.InputJsonObject {
  return {
    kinds: [...preview.kinds],
    counts: {
      foods: preview.counts.foods,
      protocols: preview.counts.protocols,
      recipes: preview.counts.recipes,
      total: preview.counts.total,
    },
    logMealAfterImport: preview.logMealAfterImport,
  } satisfies Prisma.InputJsonObject;
}

export function readHostedSharePreview(value: Prisma.JsonValue): HostedSharePreview {
  if (!isRecord(value)) {
    throw new TypeError("Hosted share preview metadata must be a JSON object.");
  }

  const counts = value.counts;

  if (!isRecord(counts)) {
    throw new TypeError("Hosted share preview counts must be a JSON object.");
  }

  return {
    kinds: readHostedSharePreviewKinds(value.kinds),
    counts: {
      foods: readHostedSharePreviewCount(counts.foods, "foods"),
      protocols: readHostedSharePreviewCount(counts.protocols, "protocols"),
      recipes: readHostedSharePreviewCount(counts.recipes, "recipes"),
      total: readHostedSharePreviewCount(counts.total, "total"),
    },
    logMealAfterImport: value.logMealAfterImport === true,
  };
}

function readHostedSharePreviewCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Hosted share preview ${field} count must be a non-negative integer.`);
  }

  return value;
}

function readHostedSharePreviewKinds(value: unknown): HostedShareKind[] {
  if (
    !Array.isArray(value)
    || value.some((entry) => entry !== "food" && entry !== "protocol" && entry !== "recipe")
  ) {
    throw new TypeError("Hosted share preview kinds must be a HostedShareKind array.");
  }

  return [...new Set(value)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
