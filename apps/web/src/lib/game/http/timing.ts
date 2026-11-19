/**
 * One request's elapsed time by stage, logged once when it ends, so a slow
 * post or upload says which stage it waited on. Names and numbers only.
 */
export class GameRequestTiming {
  readonly phaseMs: Record<string, number> = {};
  private readonly started = performance.now();

  constructor(private readonly event: string) {}

  async measure<T>(phase: string, work: () => T | PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await work(); }
    finally { this.phaseMs[phase] = (this.phaseMs[phase] ?? 0) + Math.round(performance.now() - start); }
  }

  log(fields: Record<string, string | number | boolean>): void {
    console.info(JSON.stringify({ event: this.event, ...fields,
      totalMs: Math.round(performance.now() - this.started), phaseMs: this.phaseMs }));
  }
}
