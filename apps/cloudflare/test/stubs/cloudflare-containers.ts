export class Container {
  defaultPort?: number;
  requiredPorts?: number[];
  sleepAfter: string | number = "10m";
  envVars: Record<string, string> = {};
  entrypoint?: string[];
  enableInternet = true;
  pingEndpoint = "ping";

  constructor(..._args: unknown[]) {}

  async containerFetch(
    _requestOrUrl: Request | string | URL,
    _portOrInit?: number | RequestInit,
    _portParam?: number,
  ): Promise<Response> {
    throw new Error("Test stub Container.containerFetch is not implemented.");
  }

  async destroy(): Promise<void> {}

  async fetch(_request: Request): Promise<Response> {
    throw new Error("Test stub Container.fetch is not implemented.");
  }

  async getState(): Promise<{ lastChange: number; status: "stopped" }> {
    return {
      lastChange: Date.now(),
      status: "stopped",
    };
  }

  async setOutboundByHosts(..._args: unknown[]): Promise<void> {}

  async startAndWaitForPorts(..._args: unknown[]): Promise<void> {}
}

export class ContainerProxy {}

export function getContainer(): never {
  throw new Error("Test stub getContainer is not implemented.");
}

export function getRandom(): never {
  throw new Error("Test stub getRandom is not implemented.");
}

export function outboundParams<T>(_handler: unknown, params: T): T {
  return params;
}

export function switchPort(request: Request, port: number): Request {
  const headers = new Headers(request.headers);
  headers.set("cf-container-target-port", String(port));
  return new Request(request, { headers });
}
