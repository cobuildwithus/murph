import "server-only";

type PhysicalNoteEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface PhysicalNoteConfig {
  apiKey: string;
  costUsdMicros: bigint;
  fromAddressId: string;
  pricingVersion: string;
}

export function readPhysicalNoteConfig(
  env: PhysicalNoteEnvironment = process.env,
): PhysicalNoteConfig | null {
  const apiKey = readEnv(env, "LOB_API_KEY");
  const fromAddressId = readEnv(env, "LOB_FROM_ADDRESS_ID");
  const pricingVersion = readEnv(env, "LOB_PHYSICAL_NOTE_PRICING_VERSION");
  const costText = readEnv(env, "LOB_PHYSICAL_NOTE_COST_USD_MICROS");
  if (!apiKey || !fromAddressId || !pricingVersion || !costText) {
    return null;
  }
  // Lob exposes USPS Secure Destruction as an account setting, not a letter
  // API field. This flag records the operator's completed account setup.
  if (
    apiKey.startsWith("live_")
    && (
      !isEnabled(env, "LOB_PHYSICAL_NOTES_LIVE_ENABLED")
      || !isEnabled(env, "LOB_USPS_SECURE_DESTRUCTION_CONFIRMED")
    )
  ) {
    return null;
  }
  const cost = Number(costText);
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    return null;
  }
  return {
    apiKey,
    costUsdMicros: BigInt(cost),
    fromAddressId,
    pricingVersion,
  };
}

function isEnabled(
  env: PhysicalNoteEnvironment,
  name: string,
): boolean {
  return readEnv(env, name)?.toLowerCase() === "true";
}

function readEnv(
  env: PhysicalNoteEnvironment,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value || null;
}
