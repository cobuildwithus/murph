type QueryRecordData = Record<string, unknown>;

type QueryRecordType =
  | "audit"
  | "core"
  | "event"
  | "experiment"
  | "journal"
  | "sample";

export interface VaultRecordIdentity {
  displayId: string;
  primaryLookupId: string;
}

interface EventDisplayIdentityRule {
  eventKind: string;
  displayKind: string;
  payloadKeys: readonly string[];
}

const EVENT_DISPLAY_IDENTITY_RULES = Object.freeze<EventDisplayIdentityRule[]>([
  {
    eventKind: "document",
    displayKind: "document",
    payloadKeys: ["documentId"],
  },
  {
    eventKind: "meal",
    displayKind: "meal",
    payloadKeys: ["mealId"],
  },
]);

export {
  describeLookupIdConstraint as describeLookupConstraint,
  inferLookupIdEntityKind as inferIdEntityKind,
  isQueryableLookupId,
  LOOKUP_ID_FAMILY_REGISTRY as ID_FAMILY_REGISTRY,
} from "@murphai/contracts";

export function deriveVaultRecordIdentity(
  recordType: QueryRecordType,
  payload: QueryRecordData,
  fallbackId: string,
): VaultRecordIdentity {
  if (recordType !== "event") {
    return {
      displayId: fallbackId,
      primaryLookupId: fallbackId,
    };
  }

  const eventKind = pickString(payload, ["kind"]);
  const identityRule = eventKind
    ? EVENT_DISPLAY_IDENTITY_RULES.find((rule) => rule.eventKind === eventKind)
    : null;
  const displayId = identityRule ? pickString(payload, identityRule.payloadKeys) : null;

  return {
    displayId: displayId ?? fallbackId,
    primaryLookupId: displayId ?? fallbackId,
  };
}

function pickString(
  payload: QueryRecordData | null | undefined,
  keys: readonly string[],
): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
