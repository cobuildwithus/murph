const sqliteWarningFlag = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");

installSqliteExperimentalWarningFilter();

function installSqliteExperimentalWarningFilter() {
  if (
    typeof process === "undefined" ||
    process === null ||
    typeof process.emitWarning !== "function"
  ) {
    return;
  }

  if (process[sqliteWarningFlag] === true) {
    return;
  }

  process[sqliteWarningFlag] = true;
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = (warning, ...args) => {
    const message =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : "";
    const warningType =
      typeof args[0] === "string"
        ? args[0]
        : warning instanceof Error
          ? warning.name
          : "";

    if (
      warningType === "ExperimentalWarning" &&
      message.includes("SQLite is an experimental feature")
    ) {
      return;
    }

    return originalEmitWarning(warning, ...args);
  };
}
