export class DurableObject<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  protected sql(
    _strings: TemplateStringsArray,
    ..._values: readonly unknown[]
  ): readonly unknown[] {
    return [];
  }
}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected readonly ctx: { props: Props };
  protected readonly env: Env;

  constructor(ctx: { props: Props }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
