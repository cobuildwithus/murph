export const HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";
export const HOSTED_ACCOUNT_DATA_DELETION_SCHEMA = "murph.hosted-account-data-deletion-result.v2";
export const HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES = 4 * 1024;
export const HOSTED_DATA_EXPORT_CONFIRMATION_TEXT = "EXPORT MY DATA";
export const HOSTED_DATA_EXPORT_SCHEMA = "murph.hosted-data-export.v1";
export const HOSTED_DATA_EXPORT_MIME_TYPE = "application/json; charset=utf-8";

export function buildHostedDataExportFilename(generatedAt: string): string {
  const safeTimestamp = generatedAt.replace(/[^0-9A-Za-z-]/gu, "-").replace(/-+/gu, "-");
  return `murph-data-export-${safeTimestamp || "download"}.json`;
}
