interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
}

/** Outcome-blind, variable-ratio assignment. Earlier slots dominate every later
 * slot and all pair costs together; residual edges allow earlier matches to move. */
export function matchPersonalPatternControls(
  exposedDates: readonly string[],
  comparisonDates: readonly string[],
  pairCost: (exposed: string, comparison: string) => number | null,
  maxControls = 3,
): Map<string, string[]> {
  const matches = new Map<string, string[]>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const select = (dates: readonly string[]) => [...new Set(dates)]
      .filter((date) => new Date(date).getUTCDay() === weekday).sort();
    const exposed = select(exposedDates);
    const controls = select(comparisonDates).filter((date) => !exposed.includes(date));
    const sink = exposed.length + controls.length + 1;
    const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
    const add = (from: number, to: number, cost: number) => {
      const edge = { to, reverse: graph[to].length, capacity: 1, cost };
      graph[from].push(edge);
      graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0, cost: -cost });
      return edge;
    };
    const candidates = exposed.flatMap((date, i) => controls.flatMap((control, j) => {
      const cost = pairCost(date, control);
      return cost === null ? [] : [{ i, j, cost }];
    }));
    // All costs are nonnegative bounded distances supplied by the query owner.
    const costBound = 1 + candidates.reduce((sum, edge) => sum + edge.cost, 0);
    const radix = controls.length + 1;
    exposed.forEach((_, i) => {
      for (let slot = 0; slot < maxControls; slot += 1) {
        add(0, i + 1, -costBound * radix ** (maxControls - slot - 1));
      }
    });
    controls.forEach((_, j) => add(exposed.length + j + 1, sink, 0));
    const edges = candidates.map(({ i, j, cost }) => ({
      i, j, edge: add(i + 1, exposed.length + j + 1, cost),
    }));
    while (augmentPersonalPatternFlow(graph, sink)) { /* bounded by control days */ }
    for (const { i, j, edge } of edges) {
      if (edge.capacity !== 0) continue;
      const dates = matches.get(exposed[i]) ?? [];
      dates.push(controls[j]);
      matches.set(exposed[i], dates);
    }
  }
  return matches;
}

function augmentPersonalPatternFlow(graph: FlowEdge[][], sink: number): boolean {
  const distance = Array<number>(graph.length).fill(Infinity);
  const previous: Array<{ from: number; edge: FlowEdge } | undefined> = Array(graph.length);
  distance[0] = 0;
  for (let pass = 1; pass < graph.length; pass += 1) {
    let changed = false;
    graph.forEach((edges, from) => edges.forEach((edge) => {
      const next = distance[from] + edge.cost;
      if (edge.capacity === 0 || next >= distance[edge.to]) return;
      distance[edge.to] = next;
      previous[edge.to] = { from, edge };
      changed = true;
    }));
    if (!changed) break;
  }
  if (!Number.isFinite(distance[sink]) || distance[sink] >= 0) return false;
  for (let node = sink; node !== 0;) {
    const step = previous[node];
    if (!step) throw new Error("Incomplete Personal Patterns assignment path.");
    step.edge.capacity -= 1;
    graph[node][step.edge.reverse].capacity += 1;
    node = step.from;
  }
  return true;
}
