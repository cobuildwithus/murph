type ProcessEmitWarningRestArgs = Parameters<typeof process.emitWarning> extends [
  string | Error,
  ...infer Rest,
]
  ? Rest
  : never;
type WarningTypeOption = { type: string };
type WarningDetails = {
  message: string;
  type: string;
};

const SQLITE_EXPERIMENTAL_WARNING_MESSAGE =
  "SQLite is an experimental feature and might change at any time";
const SQLITE_WARNING_FILTER_FLAG = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");

type ProcessWithSqliteWarningFilterFlag = NodeJS.Process & {
  [SQLITE_WARNING_FILTER_FLAG]?: boolean;
};

export function installSqliteExperimentalWarningFilter(): void {
  const processWithFlag = process as ProcessWithSqliteWarningFilterFlag;

  if (processWithFlag[SQLITE_WARNING_FILTER_FLAG] === true) {
    return;
  }

  processWithFlag[SQLITE_WARNING_FILTER_FLAG] = true;
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args)) {
      return;
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as ProcessEmitWarningRestArgs),
    );
  }) as typeof process.emitWarning;
}

export function isSqliteExperimentalWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  const warningDetails = readWarningDetails(warning, args);

  return (
    warningDetails.type === "ExperimentalWarning" &&
    warningDetails.message === SQLITE_EXPERIMENTAL_WARNING_MESSAGE
  );
}

function readWarningDetails(
  warning: string | Error,
  args: readonly unknown[],
): WarningDetails {
  const message = typeof warning === "string" ? warning : warning.message;

  if (typeof args[0] === "string") {
    return {
      message,
      type: args[0],
    };
  }

  if (isWarningOptionsWithType(args[0])) {
    return {
      message,
      type: args[0].type,
    };
  }

  return {
    message,
    type: warning instanceof Error ? warning.name : "",
  };
}

function isWarningOptionsWithType(value: unknown): value is WarningTypeOption {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}
