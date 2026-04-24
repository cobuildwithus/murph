import type { Expert } from "@/src/types/experiments";
import type { HealthCommonsEntity } from "./catalog";

const SOURCE_PERSON_EXPERT_QUOTES: Partial<Record<string, string>> = {
  "source_person:bryan-johnson":
    "Founder of Blueprint and Don't Die. Trying to live forever.",
};

export function toExpert(entity: HealthCommonsEntity): Expert {
  const initials = entity.title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "HC";

  return {
    initials,
    name: entity.title,
    field: entity.entityType === "source_person"
      ? ""
      : formatCategory(entity.categories?.[0] ?? "source"),
    profileImageUrl: readOptionalProfileImageUrl(entity),
    quote:
      SOURCE_PERSON_EXPERT_QUOTES[entity.key]
      ?? entity.summary
      ?? summarizeBody(entity.body),
  };
}

export function readOptionalProfileImageUrl(
  entity: HealthCommonsEntity,
): string | undefined {
  const rawValue = Reflect.get(entity, "profileImageUrl");
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const normalized = rawValue.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    (normalized.startsWith("/") && !normalized.startsWith("//"))
    || /^https?:\/\//u.test(normalized)
  ) {
    return normalized;
  }

  return undefined;
}

function formatCategory(value: string): string {
  return value
    .split(/[._/-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}
