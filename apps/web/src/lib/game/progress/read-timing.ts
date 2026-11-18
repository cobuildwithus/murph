import "server-only";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { EXERCISES } from "./registry";

type Route = "/api/game/v1/progress" | "/api/game/v1/progress/health" | "/api/game/v1/progress/friends";

/** One foreground read. Overlapping branches report elapsed time independently. */
export class ProgressReadTiming {
  readonly phaseMs = { auth: 0, cohort: 0, gameSeries: 0, rooms: 0, ownReplica: 0, friendBoards: 0,
    awards: 0, profile: 0, pictures: 0, states: 0, scoring: 0, journeys: 0, art: 0, render: 0 };
  readonly counts = { games: 0, entries: 0, friends: 0, boards: 0 };
  private pill = "all";

  selectPill(measure: string) {
    const [name, unit] = measure.split(".");
    if (measure === "steps" || measure === "sleep") this.pill = measure;
    else if (Object.hasOwn(EXERCISES, name) && ["reps", "seconds", "meters", "steps", "days"].includes(unit)) {
      this.pill = `${name}.${unit}`;
    } else this.pill = "exercise";
  }

  get selectedPill() { return this.pill; }

  async measure<T>(stage: keyof typeof this.phaseMs, work: () => T | PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await work(); }
    finally { this.phaseMs[stage] += Math.round(performance.now() - start); }
  }
}

export function withProgressReadTiming(route: Route, handler: (request: Request, timing: ProgressReadTiming) => Promise<Response>) {
  return async (request: Request) => {
    const started = performance.now(), timing = new ProgressReadTiming();
    try { return await runWithHostedDomainRootUnwrapCache(() => handler(request, timing)); }
    finally {
      console.info(JSON.stringify({ event: "game.progress.read.timing", route, pill: timing.selectedPill,
        totalMs: Math.round(performance.now() - started), phaseMs: timing.phaseMs, counts: timing.counts }));
    }
  };
}
