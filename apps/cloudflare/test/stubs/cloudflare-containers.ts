interface TestContainerStorage {
  delete(key: string): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface TestContainerContext {
  container?: {
    readonly running: boolean;
  };
  storage: TestContainerStorage;
}

interface TestContainerProxyContext {
  props: {
    className: string;
    containerId: string;
    enableInternet?: boolean;
  };
}

export interface OutboundHandlerContext {
  className: string;
  containerId: string;
  params?: unknown;
}

export type OutboundHandler = (
  request: Request,
  env: Record<string, unknown>,
  ctx: OutboundHandlerContext,
) => Promise<Response> | Response;

const outboundByHostRegistry = new Map<string, Record<string, OutboundHandler>>();
const outboundHandlersRegistry = new Map<string, Record<string, OutboundHandler>>();
const defaultOutboundHandlerNameRegistry = new Map<string, string>();

export class Container {
  static get outboundByHost(): Record<string, OutboundHandler> | undefined {
    return outboundByHostRegistry.get(this.name);
  }

  static set outboundByHost(handlers: Record<string, OutboundHandler>) {
    outboundByHostRegistry.set(this.name, handlers);
  }

  static get outbound(): OutboundHandler | undefined {
    const name = defaultOutboundHandlerNameRegistry.get(this.name);
    if (!name) {
      return undefined;
    }
    return outboundHandlersRegistry.get(this.name)?.[name];
  }

  static set outbound(handler: OutboundHandler) {
    const name = "__outbound__";
    outboundHandlersRegistry.set(this.name, {
      ...(outboundHandlersRegistry.get(this.name) ?? {}),
      [name]: handler,
    });
    defaultOutboundHandlerNameRegistry.set(this.name, name);
  }

  readonly ctx: TestContainerContext;
  defaultPort?: number;
  enableInternet = true;
  requiredPorts?: number[];
  envVars: Record<string, string> = {};
  entrypoint?: string[];
  interceptHttps = false;
  pingEndpoint = "ping";
  sleepAfter: string | number = "10m";

  constructor(ctx?: {
    container?: TestContainerContext["container"];
    storage?: TestContainerStorage;
  }) {
    this.ctx = {
      ...(ctx?.container ? { container: ctx.container } : {}),
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

export class ContainerProxy {
  readonly ctx: TestContainerProxyContext;
  readonly env: Record<string, unknown>;

  constructor(ctx: TestContainerProxyContext, env: Record<string, unknown> = {}) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const props = this.ctx.props;
    const handler = outboundByHostRegistry.get(props.className)?.[url.hostname]
      ?? readDefaultOutboundHandler(props.className);

    if (handler) {
      return await handler(request, this.env, {
        className: props.className,
        containerId: props.containerId,
      });
    }

    if (props.enableInternet) {
      return await fetch(request);
    }

    return new Response(null, { status: 403 });
  }
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

function readDefaultOutboundHandler(className: string): OutboundHandler | undefined {
  const name = defaultOutboundHandlerNameRegistry.get(className);
  if (!name) {
    return undefined;
  }
  return outboundHandlersRegistry.get(className)?.[name];
}
