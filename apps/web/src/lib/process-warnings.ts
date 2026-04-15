import {
  installSqliteExperimentalWarningFilterWithOptions,
  isSqliteExperimentalWarning,
} from "@murphai/runtime-state/node";

export function installHostedWebWarningFilters(): void {
  installSqliteExperimentalWarningFilterWithOptions({
    matchMode: "includes",
  });
}

export function isHostedWebNoiseWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  return isSqliteExperimentalWarning(warning, args, {
    matchMode: "includes",
  });
}
