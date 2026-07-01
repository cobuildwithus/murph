import { normalizeString } from "../shared.ts";

import type { JunctionEnvironment, JunctionRegion } from "./provider-types.ts";

export interface JunctionClientConfigValidationInput {
  apiKey: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
}

const JUNCTION_ENVIRONMENT_MATRIX: Readonly<Record<
  `${JunctionEnvironment}:${JunctionRegion}`,
  { apiKeyPrefix: string; baseUrl: string }
>> = Object.freeze({
  "production:us": {
    apiKeyPrefix: "pk_us_",
    baseUrl: "https://api.us.junction.com/",
  },
  "production:eu": {
    apiKeyPrefix: "pk_eu_",
    baseUrl: "https://api.eu.junction.com/",
  },
  "sandbox:us": {
    apiKeyPrefix: "sk_us_",
    baseUrl: "https://api.sandbox.us.junction.com/",
  },
  "sandbox:eu": {
    apiKeyPrefix: "sk_eu_",
    baseUrl: "https://api.sandbox.eu.junction.com/",
  },
});

export function resolveJunctionBaseUrl(
  config: Pick<JunctionClientConfigValidationInput, "environment" | "region">,
): string {
  const expected = requireJunctionEnvironmentProfile(config.environment, config.region);
  return normalizeJunctionBaseUrl(expected.baseUrl);
}

export function assertValidJunctionClientConfig(
  config: JunctionClientConfigValidationInput,
): void {
  const profile = requireJunctionEnvironmentProfile(config.environment, config.region);
  const apiKey = normalizeString(config.apiKey);

  if (!apiKey) {
    throw new TypeError("JUNCTION_API_KEY must be a non-empty string.");
  }

  if (!apiKey.startsWith(profile.apiKeyPrefix)) {
    throw new TypeError(
      `JUNCTION_API_KEY must start with ${profile.apiKeyPrefix} for ${config.environment}/${config.region}.`,
    );
  }

  resolveJunctionBaseUrl(config);
}

function requireJunctionEnvironmentProfile(
  environment: JunctionEnvironment,
  region: JunctionRegion,
) {
  const profile = JUNCTION_ENVIRONMENT_MATRIX[`${environment}:${region}`];
  if (!profile) {
    throw new TypeError("Junction environment and region must be one of sandbox|production and us|eu.");
  }

  return profile;
}

function normalizeJunctionBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("Junction API base URL must be a valid absolute URL.", { cause: error });
  }

  if (url.search || url.hash) {
    throw new TypeError("Junction API base URL must not include a query string or fragment.");
  }

  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url.toString();
}
