import {
  assertJsonValue,
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from "./json.js";
import {
  assertEvalIdentifier,
  assertNonEmptyString,
} from "./identifiers.js";
import type { EvalScenario } from "./scenario.js";

/** Artifact paths are safe POSIX-relative references; the target adapter owns their base directory. */
export interface EvalArtifactRef {
  readonly kind: string;
  readonly path: string;
  readonly mediaType?: string;
  readonly sha256?: string;
}

export interface EvalTargetContext<TInput extends JsonValue = JsonValue> {
  readonly runId: string;
  readonly caseId: string;
  readonly scenario: EvalScenario<TInput>;
  readonly trial: number;
  readonly signal: AbortSignal;
}

export interface EvalTargetExecution<
  TObservation extends JsonValue = JsonValue,
> {
  readonly observation: TObservation;
  readonly metrics?: Readonly<Record<string, number>>;
  readonly artifacts?: readonly EvalArtifactRef[];
}

export interface EvalTarget<
  TInput extends JsonValue = JsonValue,
  TObservation extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly description: string;
  /**
   * Execute one isolated case. Implementations must honor `context.signal` and
   * settle only after case-owned resources have been released.
   */
  execute(
    context: EvalTargetContext<TInput>,
  ): Promise<EvalTargetExecution<TObservation>>;
}

export function defineEvalTarget<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  target: EvalTarget<TInput, TObservation>,
): EvalTarget<TInput, TObservation> {
  assertEvalIdentifier(target.id, "target.id");
  assertNonEmptyString(target.description, "target.description");

  if (typeof target.execute !== "function") {
    throw new TypeError("target.execute must be a function.");
  }

  return Object.freeze({
    id: target.id,
    description: target.description.trim(),
    execute: target.execute,
  });
}

export function normalizeEvalTargetExecution<
  TObservation extends JsonValue,
>(
  execution: EvalTargetExecution<TObservation>,
): EvalTargetExecution<TObservation> {
  assertJsonValue(execution.observation, "target observation");

  const observation = freezeJsonValue(
    cloneJsonValue(execution.observation, "target observation"),
  );
  const metrics = normalizeMetrics(execution.metrics);
  const artifacts = normalizeArtifacts(execution.artifacts);

  return Object.freeze({
    observation,
    ...(metrics ? { metrics } : {}),
    ...(artifacts ? { artifacts } : {}),
  });
}

function normalizeMetrics(
  metrics: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  if (!metrics) {
    return undefined;
  }

  const normalized: Record<string, number> = {};
  for (const [name, value] of Object.entries(metrics)) {
    assertEvalIdentifier(name, `metric ${name}`);
    if (!Number.isFinite(value)) {
      throw new TypeError(`Metric ${name} must be finite.`);
    }
    normalized[name] = value;
  }

  return Object.freeze(normalized);
}

function assertEvalArtifactPath(value: string, label: string): void {
  assertNonEmptyString(value, label);
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes(":") ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(
      `${label} must be a safe POSIX-relative artifact path.`,
    );
  }
}

function normalizeArtifacts(
  artifacts: readonly EvalArtifactRef[] | undefined,
): readonly EvalArtifactRef[] | undefined {
  if (!artifacts) {
    return undefined;
  }

  return Object.freeze(
    artifacts.map((artifact, index) => {
      assertEvalIdentifier(artifact.kind, `artifact[${index}].kind`);
      assertEvalArtifactPath(artifact.path, `artifact[${index}].path`);
      if (artifact.mediaType !== undefined) {
        assertNonEmptyString(
          artifact.mediaType,
          `artifact[${index}].mediaType`,
        );
      }
      if (
        artifact.sha256 !== undefined &&
        !/^[0-9a-f]{64}$/u.test(artifact.sha256)
      ) {
        throw new TypeError(
          `artifact[${index}].sha256 must be a lowercase SHA-256 hex digest.`,
        );
      }

      return Object.freeze({
        kind: artifact.kind,
        path: artifact.path,
        ...(artifact.mediaType === undefined
          ? {}
          : { mediaType: artifact.mediaType }),
        ...(artifact.sha256 === undefined
          ? {}
          : { sha256: artifact.sha256 }),
      });
    }),
  );
}
