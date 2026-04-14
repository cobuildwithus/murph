type ProcessEmitWarningRestArgs = Parameters<typeof process.emitWarning> extends [
  string | Error,
  ...infer Rest,
]
  ? Rest
  : never;

const SQLITE_EXPERIMENTAL_WARNING_MESSAGE =
  "SQLite is an experimental feature and might change at any time";

let hostedWebWarningFiltersInstalled = false;

export function installHostedWebWarningFilters(): void {
  if (hostedWebWarningFiltersInstalled) {
    return;
  }

  hostedWebWarningFiltersInstalled = true;
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isHostedWebNoiseWarning(warning, args)) {
      return;
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as ProcessEmitWarningRestArgs),
    );
  }) as typeof process.emitWarning;
}

export function isHostedWebNoiseWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  const warningType = resolveWarningType(warning, args);
  const message = resolveWarningMessage(warning);

  return (
    warningType === "ExperimentalWarning" &&
    message.includes(SQLITE_EXPERIMENTAL_WARNING_MESSAGE)
  );
}

function resolveWarningMessage(warning: string | Error): string {
  return typeof warning === "string" ? warning : warning.message;
}

function resolveWarningType(
  warning: string | Error,
  args: readonly unknown[],
): string {
  if (typeof args[0] === "string") {
    return args[0];
  }

  return warning instanceof Error ? warning.name : "";
}
