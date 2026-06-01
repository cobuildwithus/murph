export const HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE =
  "HOSTED_PROVIDER_FETCH_UNAVAILABLE";

export class HostedProviderFetchUnavailableError extends Error {
  readonly code = HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE;

  constructor(operation: string) {
    super(`${operation} requires the hosted provider fetch boundary.`);
    this.name = "HostedProviderFetchUnavailableError";
  }
}

type HostedProviderFetchLike = (...args: never[]) => unknown;

export interface HostedProviderFetchDependency<TFetch extends HostedProviderFetchLike> {
  fetchImplementation: TFetch | null | undefined;
}

export function requireHostedProviderFetch<TFetch extends HostedProviderFetchLike>(
  fetchImplementation: TFetch | null | undefined,
  operation: string,
): TFetch {
  if (typeof fetchImplementation === "function") {
    return fetchImplementation;
  }

  throw new HostedProviderFetchUnavailableError(operation);
}

export function requireHostedProviderFetchDependencies<
  TFetch extends HostedProviderFetchLike,
  TDependencies extends HostedProviderFetchDependency<TFetch>,
>(
  dependencies: TDependencies,
  operation: string,
): TDependencies & { fetchImplementation: TFetch } {
  return {
    ...dependencies,
    fetchImplementation: requireHostedProviderFetch(
      dependencies.fetchImplementation,
      operation,
    ),
  };
}
