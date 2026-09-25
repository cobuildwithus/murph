import {
  installSqliteExperimentalWarningFilterWithOptions,
  isSqliteExperimentalWarning,
} from "@murphai/runtime-state/node/sqlite-warning-filter";

type ProcessEmitWarningRestArgs = Parameters<typeof process.emitWarning> extends [
  string | Error,
  ...infer Rest,
]
  ? Rest
  : never;

/**
 * pg@8 emits this once per process through `util.deprecate` when
 * `client.query()` is called while earlier queries are still pending on the
 * same client (`_queryQueue.length > 0` in pg's `Client#query`). In this
 * runtime that happens when app code awaits `Promise.all` over several
 * queries on one Prisma interactive-transaction handle: `@prisma/adapter-pg`
 * checks out a single pg client per transaction and forwards each query to
 * it, and pg queues and serializes them, so the warning describes healthy,
 * intended behavior today. It still prints to stderr once per lambda
 * instance, which Vercel surfaces as an error-level log line on otherwise
 * healthy requests.
 *
 * One process-level filter here covers every pg pool in the web runtime
 * (prisma.ts, product-labels.ts, hosted-runtime-log), since Node deprecation
 * warnings are process-global.
 *
 * Caveat: pg@9 removes the queueing this warning announces, so concurrent
 * `client.query()` on one client becomes a hard error there. Before any pg@9
 * upgrade, serialize transaction-handle queries (or prove the adapter does)
 * and delete this filter.
 */
const PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE =
  "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.";

// Node 24 emits both notices even for a capability probe via
// crypto.subtle.constructor.supports("importKey", "ML-DSA-44"). They report
// API stability, not a failed crypto operation. Match only these exact notices
// so other experimental algorithms and actual crypto failures remain visible.
const WEB_CRYPTO_EXPERIMENTAL_MESSAGES = new Set([
  "The supports Web Crypto API method is an experimental feature and might change at any time",
  "The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time",
]);

const HOSTED_WARNING_FILTER_FLAG = Symbol.for(
  "murph.hostedWebNoiseWarningFilterInstalled",
);

type ProcessWithWarningFilterFlag = NodeJS.Process & {
  [key: symbol]: boolean | undefined;
};

export function installHostedWebWarningFilters(): void {
  installSqliteExperimentalWarningFilterWithOptions({
    matchMode: "includes",
  });
  installHostedWebNoiseWarningFilter();
}

export function isHostedWebNoiseWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  return (
    isSqliteExperimentalWarning(warning, args, {
      matchMode: "includes",
    }) ||
    isPgConcurrentQueryDeprecationWarning(warning, args) ||
    isWebCryptoExperimentalWarning(warning, args)
  );
}

export function isPgConcurrentQueryDeprecationWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  const message = typeof warning === "string" ? warning : warning.message;

  return (
    readWarningType(warning, args) === "DeprecationWarning" &&
    message === PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE
  );
}

function isWebCryptoExperimentalWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  return (
    readWarningType(warning, args) === "ExperimentalWarning" &&
    WEB_CRYPTO_EXPERIMENTAL_MESSAGES.has(message)
  );
}

function installHostedWebNoiseWarningFilter(): void {
  const processWithFlag = process as ProcessWithWarningFilterFlag;

  if (processWithFlag[HOSTED_WARNING_FILTER_FLAG] === true) {
    return;
  }

  processWithFlag[HOSTED_WARNING_FILTER_FLAG] = true;
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (
      isPgConcurrentQueryDeprecationWarning(warning, args) ||
      isWebCryptoExperimentalWarning(warning, args)
    ) {
      return;
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as ProcessEmitWarningRestArgs),
    );
  }) as typeof process.emitWarning;
}

function readWarningType(
  warning: string | Error,
  args: readonly unknown[],
): string {
  if (typeof args[0] === "string") {
    return args[0];
  }

  if (
    typeof args[0] === "object" &&
    args[0] !== null &&
    "type" in args[0] &&
    typeof args[0].type === "string"
  ) {
    return args[0].type;
  }

  return warning instanceof Error ? warning.name : "";
}
