interface TestContainerStorage {
  delete(key: string): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface TestContainerContext {
  storage: TestContainerStorage;
}

export class Container {
  readonly ctx: TestContainerContext;
  defaultPort?: number;
  requiredPorts?: number[];
  envVars: Record<string, string> = {};
  entrypoint?: string[];
  pingEndpoint = "ping";

  constructor(ctx?: { storage?: TestContainerStorage }) {
    this.ctx = {
      storage: ctx?.storage ?? createMemoryStorage(),
    };
  }

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

  async startAndWaitForPorts(..._args: unknown[]): Promise<void> {}
}


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

function createMemoryStorage(): TestContainerStorage {
  const values = new Map<string, unknown>();

  return {
    async delete(key: string): Promise<boolean> {
      return values.delete(key);
    },
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
  };
}
