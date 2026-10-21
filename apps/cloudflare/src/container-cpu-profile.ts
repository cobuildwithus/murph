import type { Profiler } from "node:inspector";

const MAX_NODES = 50_000;
const MAX_SAMPLES = 60_000;
const MAX_DEPTH = 64;
const TOP_COUNT = 6;
const V8_FRAMES = new Set(["(root)", "(idle)", "(program)", "(garbage collector)"]);

// Only immutable application assets may contribute source/function labels.
// Never serialize a raw profile: eval, member files and unknown scripts can
// carry private names in both their URL and their function name.
function safeFrame(node: Profiler.ProfileNode): string {
  const frame = node.callFrame;
  if (frame.scriptId === "0" && V8_FRAMES.has(frame.functionName)) {
    return frame.functionName;
  }
  const source = frame.url.replace(/^file:\/\//u, "");
  const asset = /^(?:\/app\/)(dist-bundled|dist|node_modules)\/([@a-zA-Z0-9_./+-]+\.(?:c?js|mjs))$/u.exec(source);
  const builtin = /^node:([a-zA-Z0-9_/-]+)$/u.exec(source);
  if ((!asset && !builtin) || source.split("/").includes("..")) {
    return "(redacted)";
  }
  const location = asset ? `${asset[1]}/${asset[2]}` : `node:${builtin?.[1]}`;
  const name = /^[a-zA-Z0-9_$ .<>[\]-]{1,100}$/u.test(frame.functionName)
    ? frame.functionName
    : "(anonymous)";
  return `${location.slice(0, 160)}:${frame.lineNumber + 1}:${frame.columnNumber + 1} ${name}`;
}

export function summarizeHostedContainerCpuProfile(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.slice(0, MAX_NODES).map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  const labels = new Map<number, string>();
  for (const node of nodes.values()) {
    labels.set(node.id, safeFrame(node));
    for (const child of (node.children ?? []).slice(0, MAX_NODES)) {
      if (nodes.has(child)) parents.set(child, node.id);
    }
  }
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  let idleSamples = 0;
  let gcSamples = 0;
  let activeSamples = 0;
  let truncatedStacks = 0;
  const samples = (profile.samples ?? []).slice(0, MAX_SAMPLES);
  for (const sample of samples) {
    const leaf = labels.get(sample) ?? "(redacted)";
    if (leaf === "(idle)" || leaf === "(root)") {
      idleSamples++;
      continue;
    }
    activeSamples++;
    if (leaf === "(garbage collector)") gcSamples++;
    self.set(leaf, (self.get(leaf) ?? 0) + 1);
    const stack = collectInclusiveFrames(sample, labels, parents);
    if (stack.truncated) truncatedStacks++;
    for (const label of stack.frames) inclusive.set(label, (inclusive.get(label) ?? 0) + 1);
  }
  const top = (counts: Map<string, number>) => [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_COUNT)
    .map(([frame, count]) => ({ frame, samples: count }));
  return {
    activeSamples,
    gcSamples,
    idleSamples,
    profileDurationMs: Math.round((profile.endTime - profile.startTime) / 1000),
    sampledFrames: nodes.size,
    samples: samples.length,
    samplesTruncated: Math.max(0, (profile.samples?.length ?? 0) - samples.length),
    nodesTruncated: Math.max(0, profile.nodes.length - nodes.size),
    truncatedStacks,
    topSelfFrames: top(self),
    topInclusiveFrames: top(inclusive),
  };
}

function collectInclusiveFrames(
  sample: number,
  labels: Map<number, string>,
  parents: Map<number, number>,
): { frames: Set<string>; truncated: boolean } {
  const frames = new Set<string>();
  let id: number | undefined = sample;
  let depth = 0;
  while (id !== undefined && depth < MAX_DEPTH) {
    const label = labels.get(id) ?? "(redacted)";
    if (label !== "(root)") frames.add(label);
    id = parents.get(id);
    depth++;
  }
  return { frames, truncated: id !== undefined };
}
