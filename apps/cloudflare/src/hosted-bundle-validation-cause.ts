export const HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSES = [
  "archive_invalid",
  "artifact_integrity",
  "duplicate_file_entries",
  "invalid_artifact_metadata",
  "invalid_file_entry",
  "invalid_file_path",
  "invalid_inline_file_contents",
  "invalid_root",
  "kind_invalid",
  "payload_invalid",
  "size_limit",
] as const;

export type HostedBundleArchiveValidationCause =
  typeof HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSES[number];

const HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSE_SET = new Set<string>(
  HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSES,
);

export function readHostedBundleArchiveValidationCause(
  value: unknown,
): HostedBundleArchiveValidationCause | null {
  return typeof value === "string"
      && HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSE_SET.has(value)
    ? value as HostedBundleArchiveValidationCause
    : null;
}
