import "server-only";
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
import { assertHealthYouEnabled } from "../health-wins/flag";
import { getPrisma } from "../prisma";
import { bundleSchema, type Person } from "./contract";
import { MODEL_VERSION } from "./engine";
import { readYouInputs } from "./inputs";
import { buildViews, emptyYou } from "./views";
import { readThisWeek } from "./this-week";

const cacheSchema = z.object({ timeZone: z.string(), views: bundleSchema });
export const YOU_SCHEMA_VERSION = 3;
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
    ]),
  )!;
}
export async function publishCache(
  tx: Prisma.TransactionClient,
  observed: HealthYouCache | null,
  row: HealthYouCache,
) {
  if (!observed) return (await tx.healthYouCache.createMany({ data: [row], skipDuplicates: true })).count === 1;
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
async function computed(auth: HostedNativeMemberAuth, clock: Date, signal: AbortSignal) {
  const db = getPrisma(),
    memberId = auth.member.id;
  const observed = await db.healthYouCache.findUnique({ where: { memberId } });
  const workspace = await readHostedBrowserVaultReplicaState({ userId: memberId });
  const ref = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Private health view");
  if (!ref) throw unavailable();
  const fresh =
    assessBrowserVaultReplicaFreshness({ now: clock.toISOString(), replicaRef: ref }).freshness === "fresh";
  const cached = observed ? await open(observed, signal) : null;
  if (
    cached &&
    observed?.dependency === dependencyKey(memberId, ref, cached.timeZone, toLocalDayKey(clock, cached.timeZone))
  ) {
    return {
      views: cached.views,
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
  const inputs = await readYouInputs(memberId, signal, clock, auth.member.createdAt, workspace);
  if (inputs.sourceRevision !== ref.dataVersion) throw unavailable();
  const views = buildViews(inputs),
    dependency = dependencyKey(memberId, ref, inputs.timeZone, inputs.asOf),
    revision = randomUUID();
  const [viewsEncrypted] = await sealHealthTexts(
    [{ ...binding(memberId, revision), value: JSON.stringify({ timeZone: inputs.timeZone, views }) }],
    signal,
  );
  const won = await db.$transaction(async (tx) => {
    await authority(auth, tx);
    const current = await readHostedBrowserVaultReplicaState({ userId: memberId, prisma: tx });
    const latest = parseHostedBrowserVaultReplicaRef(
      current?.browserVaultReplicaRef ?? null,
      "Private health view",
    );
    if (
      !latest ||
      dependencyKey(memberId, latest, inputs.timeZone, toLocalDayKey(new Date(), inputs.timeZone)) !== dependency
    )
      throw unavailable();
    return publishCache(tx, observed, { memberId, dependency, revision, viewsEncrypted });
  });
  if (
    !won &&
    (await db.healthYouCache.findUnique({ where: { memberId }, select: { dependency: true } }))?.dependency !==
      dependency
  )
    throw unavailable();
  return { views, stale: null };
}
export async function readPrivateYou(
  auth: HostedNativeMemberAuth,
  kind: ReadKind,
  requestSignal: AbortSignal,
  key?: string,
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
        result = await computed(auth, clock, signal);
      } catch (error) {
        if (isHostedOnboardingError(error) && error.code !== "HEALTH_YOU_UNAVAILABLE" && error.httpStatus < 500)
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
          profile,
          stale,
          factors: you.factors.map((f) => (stale ? { ...f, state: "stale" as const } : f)),
          thisWeek: [...(await readThisWeek(memberId, you.asOf, clock, signal)), ...you.thisWeek],
        };
      }
      const detail =
        kind === "marker" ? (key && Object.hasOwn(views.markers, key) ? views.markers[key] : null) : views[kind];
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

/** Own-member pin picker. The profile owner separately authorizes publication of these two numbers. */
export async function readOwnAgeSummary(auth: HostedNativeMemberAuth, signal: AbortSignal) {
  assertHealthYouEnabled(auth.member.id);
  return withInputAuthority(
    () => getPrisma().$transaction((tx) => authority(auth, tx)),
    async () => {
      const { views, stale } = await computed(auth, new Date(), signal);
      const age = views.you.age;
      return !stale && views.you.state === "ready" && age ? { value: age.value, gap: age.gap } : null;
    },
  );
}
