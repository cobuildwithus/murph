import "server-only";

import * as z from "@murphai/contracts/zod-runtime";
import productionSet from "../../../public/.well-known/epic/production.jwks.json";
import sandboxSet from "../../../public/.well-known/epic/sandbox.jwks.json";
import { epicAssertionSigner, type EpicClientAuth } from "./epic-client-auth";
import { clinicalRecordsError } from "./errors";
import { EPIC_AUTOMATIC_RESOURCE_TYPES, isEpicAutomaticQuery } from "./epic-policy";
import type { ClinicalProviderDirectoryEntry } from "./provider-directory";

/** Default-empty feature flag: only explicitly provisioned organizations may use the broad app. */
export function epicHospitalApprovedImportsEnabled(providerId: string): boolean {
  return (process.env.EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean).includes(providerId);
}

export function epicImportQueryEnabled(providerId: string, queryScopeId: string): boolean {
  return isEpicAutomaticQuery(queryScopeId) || epicHospitalApprovedImportsEnabled(providerId);
}

type StoredRegistration = { clientId: string; grant: "callback" | "refresh" };

export const epicProfileSchema = z.object({
  environment: z.enum(["production", "sandbox"]),
  method: z.enum(["public", "basic", "private_key_jwt"]),
  hospitalApproved: z.boolean(),
}).strict();
export type EpicProfile = z.infer<typeof epicProfileSchema>;
type RegistrationOwner = Pick<ClinicalProviderDirectoryEntry, "id" | "clientIdEnvironmentKey">;

function readRegistrations(provider: RegistrationOwner) {
  const production = provider.clientIdEnvironmentKey === "EPIC_SMART_CLIENT_ID";
  const prefix = production ? "EPIC_SMART_" : "EPIC_SMART_NON_PRODUCTION_";
  const activeId = process.env[provider.clientIdEnvironmentKey]?.trim();
  const asymmetricId = process.env[prefix + "ASYMMETRIC_CLIENT_ID"]?.trim();
  const publicId = process.env[prefix + "PUBLIC_CLIENT_ID"]?.trim() || activeId;
  const approvedId = process.env[production ? "EPIC_SMART_HOSPITAL_APPROVED_CLIENT_ID"
    : "EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID"]?.trim();
  const approved = epicHospitalApprovedImportsEnabled(provider.id);
  const basic = approved ? null : readEpicPersistentCredentials(provider.id);
  return { production, prefix, activeId, asymmetricId, publicId, approvedId, approved, basic };
}

function activeRegistration(ids: ReturnType<typeof readRegistrations>) {
  if (ids.approved) return ids.approvedId;
  if (!ids.activeId || ids.activeId.length > 512) throw configurationError();
  if (ids.activeId === ids.asymmetricId) return ids.asymmetricId;
  if (ids.activeId !== ids.publicId) {
    throw configurationError(undefined, "The active Epic client ID must match the pinned public or asymmetric client ID.");
  }
  return ids.basic?.clientId ?? ids.publicId;
}

function resolveAsymmetricAuth(ids: ReturnType<typeof readRegistrations>, clientId: string, stored?: StoredRegistration) {
  if (ids.publicId === clientId) {
    throw configurationError(stored, `Set ${ids.prefix}PUBLIC_CLIENT_ID to the distinct existing public ID before selecting the asymmetric client.`);
  }
  if (ids.approvedId === clientId || ids.basic?.clientId === clientId) {
    throw configurationError(stored, "The asymmetric Epic client ID must be distinct from the hospital-approved and Basic client IDs.");
  }
  if (ids.approved && stored?.grant !== "refresh") throw configurationError(stored);
  try {
    return epicAssertionSigner(clientId, process.env[ids.prefix + "PRIVATE_KEY_PEM"] ?? "",
      ids.production ? productionSet.keys : sandboxSet.keys);
  } catch {
    throw configurationError();
  }
}

function resolveAuth(ids: ReturnType<typeof readRegistrations>, stored?: StoredRegistration): EpicClientAuth {
  const { asymmetricId, publicId, approvedId, approved, basic } = ids;
  const clientId = stored?.clientId ?? activeRegistration(ids);
  if (!clientId || clientId.length > 512) throw configurationError(stored);
  if (clientId === asymmetricId) return resolveAsymmetricAuth(ids, clientId, stored);
  if (basic?.clientId === clientId) return { method: "basic", ...basic };
  if (approved && (clientId === ids.activeId || clientId === publicId)) throw configurationError(stored);
  if (clientId !== (approved ? approvedId : publicId)) throw configurationError(stored);
  return { method: "public", clientId };
}

export function resolveEpicClient(provider: ClinicalProviderDirectoryEntry, stored?: StoredRegistration) {
  const registrations = readRegistrations(provider);
  const auth = resolveAuth(registrations, stored);
  const hospitalApprovedImports = registrations.approved && auth.clientId === registrations.approvedId;
  const profile: EpicProfile = { environment: registrations.production ? "production" : "sandbox",
    method: auth.method, hospitalApproved: hospitalApprovedImports };
  return { auth, profile, hospitalApprovedImports, resourceTypes: hospitalApprovedImports ? provider.resourceTypes
    : provider.resourceTypes.filter(type => EPIC_AUTOMATIC_RESOURCE_TYPES.includes(type)) };
}

/** Historical Epic artifacts had one fixed sandbox entry and production brands. */
export function resolveSavedEpicAuth(providerId: string, stored: StoredRegistration, profile?: EpicProfile) {
  const sandbox = profile ? profile.environment === "sandbox" : providerId === "epic-sandbox";
  const ids = readRegistrations({ id: providerId, clientIdEnvironmentKey:
    sandbox ? "EPIC_SMART_NON_PRODUCTION_CLIENT_ID" : "EPIC_SMART_CLIENT_ID" });
  if (profile?.method === "public" && !ids.approved && !profile.hospitalApproved && stored.clientId === ids.publicId
    && stored.clientId !== ids.asymmetricId && stored.clientId !== ids.approvedId) {
    return { method: "public", clientId: stored.clientId } as const;
  }
  const auth = resolveAuth(ids, stored);
  if (profile && (auth.method !== profile.method ||
    profile.hospitalApproved !== (ids.approved && auth.clientId === ids.approvedId))) throw configurationError(stored);
  return auth;
}

function configurationError(stored?: StoredRegistration, message?: string) {
  return clinicalRecordsError(stored ? {
    code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED", httpStatus: 409,
    message: message ?? "The provider configuration changed. Start the connection again.",
  } : {
    code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED", httpStatus: 503, retryable: true,
    message: message ?? "The selected Clinical Records provider is not configured yet.",
  });
}

/** Credentials are provisioned per organization; never expose this result to browser contracts. */
function readEpicPersistentCredentials(providerId: string): { clientId: string; clientSecret: string } | null {
  const raw = process.env.EPIC_SMART_PERSISTENT_CREDENTIALS;
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError("Persistent Epic credentials are not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Persistent Epic credentials are invalid.");
  const entry: unknown = Object.hasOwn(parsed, providerId) ? Reflect.get(parsed, providerId) : undefined;
  if (entry === undefined) return null;
  if (!entry || typeof entry !== "object") throw new TypeError("Persistent Epic credentials are invalid.");
  const clientId: unknown = Reflect.get(entry, "clientId");
  const clientSecret: unknown = Reflect.get(entry, "clientSecret");
  if (typeof clientId !== "string" || !clientId.trim() || clientId.length > 512
    || typeof clientSecret !== "string" || !clientSecret || clientSecret.length > 8192) {
    throw new TypeError("Persistent Epic credentials are invalid.");
  }
  return { clientId, clientSecret };
}
