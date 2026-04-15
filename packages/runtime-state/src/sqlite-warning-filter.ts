type ProcessEmitWarningRestArgs = Parameters<typeof process.emitWarning> extends [
  string | Error,
  ...infer Rest,
]
  ? Rest
  : never;
export type SqliteExperimentalWarningMatchMode = "exact" | "includes";
type WarningTypeOption = { type: string };
type WarningDetails = {
  message: string;
  type: string;
};
type SqliteExperimentalWarningFilterOptions = {
  matchMode?: SqliteExperimentalWarningMatchMode;
};

const SQLITE_EXPERIMENTAL_WARNING_MESSAGE =
  "SQLite is an experimental feature and might change at any time";
const SQLITE_WARNING_FILTER_FLAG = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");

type ProcessWithSqliteWarningFilterFlag = NodeJS.Process & {
  [key: symbol]: boolean | undefined;
};

export function installSqliteExperimentalWarningFilter(): void {
  installSqliteExperimentalWarningFilterWithOptions();
}

export function installSqliteExperimentalWarningFilterWithOptions(
  options: SqliteExperimentalWarningFilterOptions = {},
): void {
  const processWithFlag = process as ProcessWithSqliteWarningFilterFlag;
  const matchMode = options.matchMode ?? "exact";
  const filterFlag = getSqliteWarningFilterFlag(matchMode);

  if (processWithFlag[filterFlag] === true) {
    return;
  }

  processWithFlag[filterFlag] = true;
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args, options)) {
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
  options: SqliteExperimentalWarningFilterOptions = {},
): boolean {
  const warningDetails = readWarningDetails(warning, args);
  const matchMode = options.matchMode ?? "exact";

  return (
    warningDetails.type === "ExperimentalWarning" &&
    matchesSqliteExperimentalWarningMessage(warningDetails.message, matchMode)
  );
}

function matchesSqliteExperimentalWarningMessage(
  message: string,
  matchMode: SqliteExperimentalWarningMatchMode,
): boolean {
  return matchMode === "includes"
    ? message.includes(SQLITE_EXPERIMENTAL_WARNING_MESSAGE)
    : message === SQLITE_EXPERIMENTAL_WARNING_MESSAGE;
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

function getSqliteWarningFilterFlag(
  matchMode: SqliteExperimentalWarningMatchMode,
): symbol {
  return matchMode === "includes"
    ? Symbol.for("murph.sqliteExperimentalWarningFilterInstalled.includes")
    : SQLITE_WARNING_FILTER_FLAG;
}
