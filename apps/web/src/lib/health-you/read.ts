import "server-only";
import { keepDailyQuestions, questionsForClient } from "./questions";
import { scheduleBrowserVaultRefresh } from "../browser-vault/session-handler";
import { randomUUID } from "node:crypto";
import { toLocalDayKey } from "@murphai/contracts";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import * as z from "@murphai/contracts/zod-runtime";
import type { HealthYouCache, Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { assertGameMemberAuthCurrentForRead } from "../game/http/auth";
import { gameNotFound } from "../game/http/errors";
import { gameMediaUrl } from "../game/views";
import { openGameTexts } from "../game/crypto";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedBrowserVaultReplicaState } from "../hosted-workspace/store";
import { openHealthTexts, sealHealthTexts } from "../health-wins/crypto";
import { withInputAuthority } from "../health-wins/input-authority";
import { isHealthYouEnabled } from "../health-wins/flag";
import { getPrisma } from "../prisma";
import { bundleSchema, type Person } from "./contract";
import { MODEL_VERSION } from "./engine";
import { readYouInputs } from "./inputs";
import { gameProofs, habitEvidence } from "./game-habits";
import { buildViews, emptyYou } from "./views";
import { readThisWeek } from "./this-week";

const cacheSchema = z.object({ timeZone: z.string(), views: bundleSchema });
export const YOU_SCHEMA_VERSION = 7;
type ReadKind = "you" | "age" | "week" | "sleep" | "fitness" | "blood" | "marker";
function binding(memberId: string, revision: string) {
  return { memberId, table: "health_you_cache", rowId: revision, field: "views" } as const;
}
async function open(row: HealthYouCache, signal: AbortSignal) {
  const [text] = await openHealthTexts(
    [{ ...binding(row.memberId, row.revision), value: row.viewsEncrypted }],
    signal,
  );
  try {
    const decoded = cacheSchema.safeParse(JSON.parse(text));
    return decoded.success ? decoded.data : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
export function dependencyKey(
  memberId: string,
  ref: NonNullable<ReturnType<typeof parseHostedBrowserVaultReplicaRef>>,
  zone: string,
  date: string,
  gameRevision = "",
) {
  return createHostedOpaqueIdentifier(
    "health-you-view",
    JSON.stringify([
      memberId,
      MODEL_VERSION,
      YOU_SCHEMA_VERSION,
      ref.dataVersion,
      ref.generatedAt,
      ref.objectKey,
      ref.generation,
      zone,
      date,
      gameRevision,
    ]),
  )!;
}
export async function publishCache(
  tx: Prisma.TransactionClient,
  observed: HealthYouCache | null,
  row: HealthYouCache,
) {
  if (!observed)
    return (await tx.healthYouCache.createMany({ data: [row], skipDuplicates: true })).count === 1;
  return (
    (
      await tx.healthYouCache.updateMany({
        where: { memberId: row.memberId, revision: observed.revision },
        data: { revision: row.revision, dependency: row.dependency, viewsEncrypted: row.viewsEncrypted },
      })
    ).count === 1
  );
}
async function authority(auth: HostedNativeMemberAuth, tx: Prisma.TransactionClient) {
  await assertGameMemberAuthCurrentForRead(auth, tx);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
}
function unavailable() {
  return hostedOnboardingError({
    code: "HEALTH_YOU_UNAVAILABLE",
    httpStatus: 503,
    retryable: true,
    message: "Your health view could not load. Try again.",
  });
}
async function computed(
  member: { id: string; createdAt: Date },
  clock: Date,
  signal: AbortSignal,
  checkAuthority: (tx: Prisma.TransactionClient) => Promise<void>,
  refreshOwner = false,
) {
  const db = getPrisma(),
    memberId = member.id;
  const observed = await db.healthYouCache.findUnique({ where: { memberId } });
  const workspace = await readHostedBrowserVaultReplicaState({ userId: memberId });
  const ref = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Private health view",
  );
  const fresh =
    assessBrowserVaultReplicaFreshness({ now: clock.toISOString(), replicaRef: ref }).freshness === "fresh";
  if (!fresh && refreshOwner) scheduleBrowserVaultRefresh(memberId);
  if (!ref) throw unavailable();
  const proofs = await gameProofs(db, memberId, clock);
  const cached = observed ? await open(observed, signal) : null;
  if (
    cached &&
    observed?.dependency ===
      dependencyKey(memberId, ref, cached.timeZone, toLocalDayKey(clock, cached.timeZone), proofs.revision)
  ) {
    return {
      views: cached.views,
      revision: observed.revision,
      timeZone: cached.timeZone,
      stale: fresh ? null : { since: ref.generatedAt, text: "Showing your last available measurements." },
    };
  }
  if (!fresh) throw unavailable();
  if (
    !(
      await hostedAuthRateLimitStorage(db).consume("health-you-compute:member:" + memberId, {
        max: 12,
        window: 60,
      })
    ).allowed
  )
    throw unavailable();
  const inputs = await readYouInputs(memberId, signal, clock, member.createdAt, workspace).catch((error) => {
    signal.throwIfAborted();
    if (isHostedOnboardingError(error) && error.httpStatus < 500) throw error;
    throw unavailable();
  });
  if (inputs.sourceRevision !== ref.dataVersion) throw unavailable();
  inputs.evidence.habits = await habitEvidence(db, memberId, proofs.rows, inputs.timeZone, signal);
  const views = buildViews(inputs),
    dependency = dependencyKey(memberId, ref, inputs.timeZone, inputs.asOf, proofs.revision),
    revision = randomUUID();
  keepDailyQuestions(views, cached?.views);
  const [viewsEncrypted] = await sealHealthTexts(
    [{ ...binding(memberId, revision), value: JSON.stringify({ timeZone: inputs.timeZone, views }) }],
    signal,
  );
  const won = await db.$transaction(async (tx) => {
    await checkAuthority(tx);
    const current = await readHostedBrowserVaultReplicaState({ userId: memberId, prisma: tx });
    const latest = parseHostedBrowserVaultReplicaRef(
      current?.browserVaultReplicaRef ?? null,
      "Private health view",
    );
    if (
      !latest ||
      dependencyKey(
        memberId,
        latest,
        inputs.timeZone,
        toLocalDayKey(new Date(), inputs.timeZone),
        (await gameProofs(tx, memberId, new Date())).revision,
      ) !== dependency
    )
      throw unavailable();
    return publishCache(tx, observed, { memberId, dependency, revision, viewsEncrypted });
  });
  if (!won) {
    const winner = await db.healthYouCache.findUnique({ where: { memberId } });
    if (!winner || winner.dependency !== dependency) throw unavailable();
    const stored = await open(winner, signal);
    if (!stored) throw unavailable();
    return { ...stored, revision: winner.revision, stale: null };
  }
  return { views, revision, timeZone: inputs.timeZone, stale: null };
}
export async function readPrivateYou(
  auth: HostedNativeMemberAuth,
  kind: ReadKind,
  requestSignal: AbortSignal,
  key?: string,
  headers?: Headers,
) {
  const db = getPrisma(),
    memberId = auth.member.id,
    clock = new Date();
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(12000)]);
  return withInputAuthority(
    () => db.$transaction((tx) => authority(auth, tx)),
    async () => {
      const saved = await db.gameProfile.findUnique({
        where: { memberId },
        select: { timeZone: true, photoKey: true, firstNameEncrypted: true },
      });
      const [name] = await openGameTexts(
        [
          {
            memberId,
            table: "game_profile",
            rowId: memberId,
            field: "first_name",
            value: saved?.firstNameEncrypted,
          },
        ],
        signal,
      );
      const profile: Person = {
        memberId,
        firstName: name ?? "You",
        avatarUrl: saved?.photoKey ? gameMediaUrl(saved.photoKey) : null,
      };
      let result: Awaited<ReturnType<typeof computed>>;
      try {
        result = await computed(auth.member, clock, signal, (tx) => authority(auth, tx), true);
      } catch (error) {
        if (
          isHostedOnboardingError(error) &&
          error.code !== "HEALTH_YOU_UNAVAILABLE" &&
          error.httpStatus < 500
        )
          throw error;
        requestSignal.throwIfAborted();
        if (kind === "you" && saved?.timeZone) return emptyYou(profile, toLocalDayKey(clock, saved.timeZone));
        throw unavailable();
      }
      const { views, stale } = result;
      if (kind === "you") {
        const you = views.you;
        return {
          ...you,
          questions: questionsForClient(views, headers),
          profile,
          stale,
          factors: you.factors.map((f) => (stale ? { ...f, state: "stale" as const } : f)),
          thisWeek: [...(await readThisWeek(memberId, you.asOf, clock, signal)), ...you.thisWeek],
        };
      }
      const detail =
        kind === "marker"
          ? key && Object.hasOwn(views.markers, key)
            ? views.markers[key]
            : null
          : views[kind];
      if (!detail) {
        if (kind === "marker") throw gameNotFound();
        throw hostedOnboardingError({
          code: "HEALTH_YOU_NOT_READY",
          httpStatus: 409,
          message: "There is no personal estimate for this period yet.",
        });
      }
      return { ...detail, stale };
    },
  );
}

/** Profile callers authorize the audience and the selector. The owner still needs vault authority. */
export async function readYouAgeForPin(memberId: string) {
  if (!isHealthYouEnabled(memberId)) return null;
  const db = getPrisma();
  const check = (tx: Prisma.TransactionClient) => assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
  try {
    return await withInputAuthority(
      () => check(db),
      async () => {
        const member = await db.hostedMember.findUniqueOrThrow({
          where: { id: memberId },
          select: { id: true, createdAt: true },
        });
        const { views, revision, timeZone, stale } = await computed(
          member,
          new Date(),
          AbortSignal.timeout(12000),
          check,
        );
        const age = views.you.age;
        return !stale && views.you.state === "ready" && age
          ? { value: age.value, gap: age.gap, revision, timeZone }
          : null;
      },
    );
  } catch (error) {
    if (
      isHostedOnboardingError(error) &&
      (error.code === "HEALTH_YOU_UNAVAILABLE" || [403, 404].includes(error.httpStatus))
    )
      return null;
    throw error;
  }
}

export async function isYouAgePinCurrent(
  tx: Prisma.TransactionClient,
  memberId: string,
  offer: { revision: string; timeZone: string },
) {
  // Lock both the publication pointer and cache row through the pin write.
  const [row] = await tx.$queryRaw<{ ref: unknown; dependency: string }[]>`
    SELECT w.browser_vault_replica_ref AS ref, c.dependency
    FROM hosted_workspace w JOIN health_you_cache c ON c.member_id = w.user_id
    WHERE w.user_id = ${memberId} AND c.revision = ${offer.revision}::uuid FOR SHARE OF w, c`;
  const ref = row && parseHostedBrowserVaultReplicaRef(row.ref, "Private health pin");
  const clock = new Date();
  return Boolean(
    ref &&
      assessBrowserVaultReplicaFreshness({ now: clock.toISOString(), replicaRef: ref }).freshness ===
        "fresh" &&
      row.dependency ===
        dependencyKey(
          memberId,
          ref,
          offer.timeZone,
          toLocalDayKey(clock, offer.timeZone),
          (await gameProofs(tx, memberId, clock)).revision,
        ),
  );
}
