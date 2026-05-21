import { Client, Connection, type ConnectionOptions } from "@temporalio/client";

import {
  readHostedRuntimeTemporalEnvironment,
  type HostedRuntimeTemporalTls,
} from "../temporal-env.js";

export interface HostedRuntimeTemporalClientOptions {
  address?: string;
  apiKey?: string;
  connection?: Connection;
  namespace?: string;
  tls?: HostedRuntimeTemporalTls;
}

export async function createHostedRuntimeTemporalClient(
  options: HostedRuntimeTemporalClientOptions = {},
): Promise<Client> {
  const connection =
    options.connection ??
    (await Connection.connect(buildConnectionOptions(options)));

  return new Client({
    connection,
    namespace: options.namespace ?? "default",
  });
}

export async function createHostedRuntimeTemporalClientFromEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Client> {
  const environment = readHostedRuntimeTemporalEnvironment(source);
  return createHostedRuntimeTemporalClient({
    address: environment.address,
    apiKey: environment.apiKey,
    namespace: environment.namespace,
    tls: environment.tls,
  });
}

function buildConnectionOptions(
  options: HostedRuntimeTemporalClientOptions,
): ConnectionOptions {
  return {
    ...(options.address ? { address: options.address } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    tls: options.tls ?? false,
  };
}
