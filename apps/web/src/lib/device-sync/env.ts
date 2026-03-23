import { decodeHostedEncryptionKey } from "./crypto";
import { normalizeString, parseCommaSeparatedList } from "./shared";

export interface HostedOAuthProviderEnvironment {
  clientId: string;
  clientSecret: string;
}

export interface HostedDeviceSyncEnvironment {
  allowedReturnOrigins: string[];
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  isProduction: boolean;
  ouraWebhookVerificationToken: string | null;
  publicBaseUrl: string | null;
  trustedUserEmailHeader: string | null;
  trustedUserIdHeader: string;
  trustedUserNameHeader: string | null;
  devUserEmail: string | null;
  devUserId: string | null;
  devUserName: string | null;
  providers: {
    whoop: HostedOAuthProviderEnvironment | null;
    oura: HostedOAuthProviderEnvironment | null;
  };
}

export function readHostedDeviceSyncEnvironment(source: NodeJS.ProcessEnv = process.env): HostedDeviceSyncEnvironment {
  const encryptionKey = normalizeString(source.HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY);
  const encryptionKeyVersion = normalizeString(source.HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY_VERSION) ?? "v1";

  if (!encryptionKey) {
    throw new TypeError("HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY is required for the hosted device-sync control plane.");
  }

  return {
    allowedReturnOrigins: parseCommaSeparatedList(source.HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS),
    encryptionKey: decodeHostedEncryptionKey(encryptionKey),
    encryptionKeyVersion,
    isProduction: (source.NODE_ENV ?? "development") === "production",
    ouraWebhookVerificationToken: normalizeString(source.HEALTHYBOB_OURA_WEBHOOK_VERIFICATION_TOKEN),
    publicBaseUrl: normalizeString(source.HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL),
    trustedUserEmailHeader: normalizeHeaderName(source.HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER),
    trustedUserIdHeader:
      normalizeHeaderName(source.HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_ID_HEADER) ?? "x-healthybob-user-id",
    trustedUserNameHeader: normalizeHeaderName(source.HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_NAME_HEADER),
    devUserEmail: normalizeString(source.HEALTHYBOB_DEVICE_SYNC_DEV_USER_EMAIL),
    devUserId: normalizeString(source.HEALTHYBOB_DEVICE_SYNC_DEV_USER_ID),
    devUserName: normalizeString(source.HEALTHYBOB_DEVICE_SYNC_DEV_USER_NAME),
    providers: {
      whoop: buildProviderEnvironment(source.HEALTHYBOB_WHOOP_CLIENT_ID, source.HEALTHYBOB_WHOOP_CLIENT_SECRET),
      oura: buildProviderEnvironment(source.HEALTHYBOB_OURA_CLIENT_ID, source.HEALTHYBOB_OURA_CLIENT_SECRET),
    },
  };
}

function buildProviderEnvironment(
  clientId: string | undefined,
  clientSecret: string | undefined,
): HostedOAuthProviderEnvironment | null {
  const normalizedClientId = normalizeString(clientId);
  const normalizedClientSecret = normalizeString(clientSecret);

  if (!normalizedClientId && !normalizedClientSecret) {
    return null;
  }

  if (!normalizedClientId || !normalizedClientSecret) {
    throw new TypeError("Hosted WHOOP/Oura provider configuration must include both client ID and client secret.");
  }

  return {
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
  };
}

function normalizeHeaderName(value: string | undefined): string | null {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}
