import {
  deleteHostedAddressBookProjection,
  HOSTED_ADDRESS_BOOK_DELETE_BODY_MAX_BYTES,
  HOSTED_ADDRESS_BOOK_REPLACEMENT_BODY_MAX_BYTES,
  parseHostedAddressBookDeleteRequest,
  parseHostedAddressBookReplaceRequest,
  readHostedAddressBookStatus,
  replaceHostedAddressBookProjection,
} from "@/src/lib/hosted-address-book/projection";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import {
  type PrivyBearerMemberAuthStage,
  requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const maxDuration = 60;

const SLOW_GET_STAGE_MS = 5_000;

type AddressBookGetStage = PrivyBearerMemberAuthStage | "status_read";

async function runObservedGetStage<TResult>(
  stage: AddressBookGetStage,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const startedAtMs = Date.now();
  const timer = setTimeout(() => {
    console.warn("Hosted companion address-book GET stage slow.", {
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      stage,
    });
  }, SLOW_GET_STAGE_MS);

  try {
    return await run();
  } finally {
    clearTimeout(timer);
  }
}

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma, {
    runStage: runObservedGetStage,
  });
  return jsonOk(await runObservedGetStage(
    "status_read",
    () => readHostedAddressBookStatus({
      memberId: auth.member.id,
      prisma,
    }),
  ));
});

export const PUT = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const replacement = parseHostedAddressBookReplaceRequest(
    await readJsonObject(request, {
      limitBytes: HOSTED_ADDRESS_BOOK_REPLACEMENT_BODY_MAX_BYTES,
    }),
  );
  return jsonOk(await replaceHostedAddressBookProjection({
    memberId: auth.member.id,
    prisma,
    request: replacement,
  }));
});

export const DELETE = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  const deletion = parseHostedAddressBookDeleteRequest(
    await readJsonObject(request, {
      limitBytes: HOSTED_ADDRESS_BOOK_DELETE_BODY_MAX_BYTES,
    }),
  );
  return jsonOk(await deleteHostedAddressBookProjection({
    memberId: auth.member.id,
    prisma,
    request: deletion,
  }));
});
