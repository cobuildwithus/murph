import { pathToFileURL } from "node:url";

export const PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE =
  "MURPH_LABELS_DB_URL is required for /api/foods and /api/supplements; MURPH_SUPPLEMENT_DB_URL is not a runtime fallback.";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function listProductLabelRuntimeEnvErrors(
  source: EnvSource = process.env,
): string[] {
  if (!shouldRequireProductLabelsDatabase(source)) {
    return [];
  }

  if (normalizeOptionalString(source.MURPH_LABELS_DB_URL)) {
    return [];
  }

  return [PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE];
}

export function assertProductLabelRuntimeEnv(
  source: EnvSource = process.env,
): void {
  const errors = listProductLabelRuntimeEnvErrors(source);

  if (errors.length > 0) {
    throw new TypeError(errors.join(" "));
  }
}

function shouldRequireProductLabelsDatabase(source: EnvSource): boolean {
  return normalizeOptionalString(source.VERCEL_ENV) === "production"
    || normalizeOptionalString(source.MURPH_REQUIRE_PRODUCT_LABELS_DB) === "1";
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertProductLabelRuntimeEnv();
}
