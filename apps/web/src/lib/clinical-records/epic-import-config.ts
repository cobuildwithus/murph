import "server-only";

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

function readRegistrations(provider: ClinicalProviderDirectoryEntry) {
  const production = provider.clientIdEnvironmentKey === "EPIC_SMART_CLIENT_ID";
  const prefix = production ? "EPIC_SMART_" : "EPIC_SMART_NON_PRODUCTION_";
  const activeId = process.env[provider.clientIdEnvironmentKey]?.trim();
  const asymmetricId = process.env[prefix + "ASYMMETRIC_CLIENT_ID"]?.trim();
  // Before asymmetric provisioning the existing automatic registration is public.
  const publicId = process.env[prefix + "PUBLIC_CLIENT_ID"]?.trim() || (!asymmetricId ? activeId : undefined);
  const approvedId = process.env[production ? "EPIC_SMART_HOSPITAL_APPROVED_CLIENT_ID"
    : "EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID"]?.trim();
  const basic = readEpicPersistentCredentials(provider.id);
  return { production, prefix, activeId, asymmetricId, publicId, approvedId, basic };
}

function activeRegistration(ids: ReturnType<typeof readRegistrations>, approved: boolean) {
  if (approved) return ids.approvedId;
  if (!ids.activeId) throw configurationError();
  if (ids.activeId === ids.asymmetricId) return ids.asymmetricId;
  if (ids.activeId !== ids.publicId) throw configurationError();
  return ids.basic?.clientId ?? ids.publicId;
}

export function resolveEpicClient(provider: ClinicalProviderDirectoryEntry, stored?: StoredRegistration) {
  const registrations = readRegistrations(provider);
  const { production, prefix, asymmetricId, publicId, approvedId, basic } = registrations;
  const approved = epicHospitalApprovedImportsEnabled(provider.id);
  const clientId = stored ? stored.clientId : activeRegistration(registrations, approved);
  const ids = [publicId, approvedId, asymmetricId, basic?.clientId];
  if (!clientId || clientId.length > 512 || ids.filter(id => id === clientId).length !== 1) {
    throw configurationError(stored);
  }
  const hospitalApprovedImports = clientId === approvedId;
  if (stored?.grant !== "refresh" && hospitalApprovedImports !== approved) throw configurationError(stored);
  let auth: EpicClientAuth;
  if (asymmetricId === clientId) {
    try {
      auth = epicAssertionSigner(clientId, process.env[prefix + "PRIVATE_KEY_PEM"] ?? "",
        production ? productionSet.keys : sandboxSet.keys);
    } catch {
      throw configurationError();
    }
  } else if (basic?.clientId === clientId) {
    auth = { method: "basic", ...basic };
  } else {
    auth = { method: "public", clientId };
  }
  return { auth, hospitalApprovedImports, resourceTypes: hospitalApprovedImports ? provider.resourceTypes
    : provider.resourceTypes.filter(type => EPIC_AUTOMATIC_RESOURCE_TYPES.includes(type)) };
}

function configurationError(stored?: StoredRegistration) {
  return clinicalRecordsError(stored ? {
    code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED", httpStatus: 409,
    message: "The provider configuration changed. Start the connection again.",
  } : {
    code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED", httpStatus: 503, retryable: true,
    message: "The selected Clinical Records provider is not configured yet.",
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
