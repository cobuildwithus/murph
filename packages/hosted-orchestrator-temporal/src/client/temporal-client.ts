import { Client, Connection, type ConnectionOptions } from "@temporalio/client";

import { readHostedRuntimeTemporalEnvironment } from "../temporal-env.js";

export interface HostedRuntimeTemporalClientOptions {
  address?: string;
  connection?: Connection;
  namespace?: string;
  tls?: boolean;
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
    namespace: environment.namespace,
    tls: environment.tls,
  });
}

function buildConnectionOptions(
  options: HostedRuntimeTemporalClientOptions,
): ConnectionOptions {
  return {
    ...(options.address ? { address: options.address } : {}),
    tls: options.tls === true,
  };
}
