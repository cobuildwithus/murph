from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, before: str, after: str, label: str) -> None:
    content = read(path)
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor in {path}, found {count}")
    write(path, content.replace(before, after, 1))


def insert_before(path: str, anchor: str, addition: str, label: str) -> None:
    content = read(path)
    count = content.count(anchor)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor in {path}, found {count}")
    write(path, content.replace(anchor, addition + anchor, 1))


replace_once(
    "apps/web/src/lib/hosted-groups/group-start-handoff.ts",
    "const HOSTED_GROUP_START_HANDOFF_TTL_MS = 24 * 60 * 60 * 1_000;",
    "const HOSTED_GROUP_START_HANDOFF_TTL_MS = 30 * 60 * 1_000;",
    "short group-start handoff",
)

setup_path = "apps/web/src/lib/hosted-onboarding/linq-group-setup.ts"
replace_once(
    setup_path,
    '''import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";''',
    '''import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";''',
    "remove random recovery nonce",
)
replace_once(
    setup_path,
    '''const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN =
  "murph.linq-group-email-recovery.v1";''',
    '''const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN =
  "murph.linq-group-email-recovery.v1";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_ENCRYPTION_KEY_DOMAIN =
  "murph.linq-group-email-recovery.v1.encryption-key";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_KEY_DOMAIN =
  "murph.linq-group-email-recovery.v1.iv-key";''',
    "domain-separate recovery token keys",
)
replace_once(
    setup_path,
    '''  const iv = randomBytes(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedLinqGroupEmailRecoveryKey(),
    iv,
  );''',
    '''  const iv = createHmac(
    "sha256",
    deriveHostedLinqGroupEmailRecoveryIvKey(),
  )
    .update(plaintext)
    .digest()
    .subarray(0, HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedLinqGroupEmailRecoveryEncryptionKey(),
    iv,
  );''',
    "derive deterministic recovery token nonce",
)
replace_once(
    setup_path,
    '''      deriveHostedLinqGroupEmailRecoveryKey(),
      iv,''',
    '''      deriveHostedLinqGroupEmailRecoveryEncryptionKey(),
      iv,''',
    "use recovery encryption key for open",
)
replace_once(
    setup_path,
    '''function deriveHostedLinqGroupEmailRecoveryKey(): Buffer {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN, "utf8")
    .digest();
}''',
    '''function deriveHostedLinqGroupEmailRecoveryEncryptionKey(): Buffer {
  return deriveHostedLinqGroupEmailRecoveryKey(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_ENCRYPTION_KEY_DOMAIN,
  );
}

function deriveHostedLinqGroupEmailRecoveryIvKey(): Buffer {
  return deriveHostedLinqGroupEmailRecoveryKey(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_KEY_DOMAIN,
  );
}

function deriveHostedLinqGroupEmailRecoveryKey(domain: string): Buffer {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(domain, "utf8")
    .digest();
}''',
    "derive separate recovery token keys",
)
replace_once(
    setup_path,
    '''    participantContact,
    recipientPhone,''',
    '''    participantContact: {
      kind: "email",
      lookupKey: participantContact.lookupKey,
      value: participantContact.value,
    },
    recipientPhone,''',
    "narrow recovered email contact",
)

replace_once(
    "apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts",
    '''        recoveryToken: issueHostedLinqGroupEmailRecoveryToken({
          chatId: input.chatId,
          observedAt: input.occurredAt,''',
    '''        recoveryToken: issueHostedLinqGroupEmailRecoveryToken({
          chatId: input.chatId,
          now: new Date(input.occurredAt),
          observedAt: input.occurredAt,''',
    "bind recovery token time to provider event",
)

routing_path = "apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts"
replace_once(
    routing_path,
    '''import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";''',
    '''import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";''',
    "import pending group route lookup keys",
)
replace_once(
    routing_path,
    '''export async function lookupHostedMemberRoutingByPendingLinqParticipantContact(input: {
  contact: HostedLinqParticipantContact;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberRoutingLookup | null> {
  const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: input.contact.kind,
    value: input.contact.value,
  });
  if (lookupKeys.length === 0) {
    return null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: lookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return resolveUniqueHostedMemberRoutingLookup({
    ambiguityCode: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "pendingLinqParticipantContactLookupKey",
    prisma: input.prisma,
    routingRecords,
  });
}''',
    '''export async function lookupHostedMemberRoutingByPendingLinqParticipantContact(input: {
  contact: HostedLinqParticipantContact;
  linqChatId?: string | null;
  prisma: HostedOnboardingReadClient;
  recipientPhone?: string | null;
}): Promise<HostedMemberRoutingLookup | null> {
  const contactLookupKeys =
    createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: input.contact.kind,
      value: input.contact.value,
    });
  const scopedToGroup =
    input.linqChatId !== undefined || input.recipientPhone !== undefined;
  if (
    scopedToGroup
    && (input.linqChatId === undefined || input.recipientPhone === undefined)
  ) {
    throw new TypeError(
      "Pending Linq group contact lookup requires both chat and recipient line.",
    );
  }
  const chatLookupKeys = scopedToGroup
    ? createHostedLinqChatLookupKeyReadCandidates(input.linqChatId)
    : [];
  const recipientLookupKeys = scopedToGroup
    ? createHostedPhoneLookupKeyReadCandidates(input.recipientPhone)
    : [];
  if (
    contactLookupKeys.length === 0
    || (scopedToGroup
      && (chatLookupKeys.length === 0 || recipientLookupKeys.length === 0))
  ) {
    return null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: contactLookupKeys,
      },
      ...(scopedToGroup
        ? {
            pendingLinqChatLookupKey: {
              in: chatLookupKeys,
            },
            pendingLinqRecipientPhoneLookupKey: {
              in: recipientLookupKeys,
            },
          }
        : {}),
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return resolveUniqueHostedMemberRoutingLookup({
    ambiguityCode: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "pendingLinqParticipantContactLookupKey",
    prisma: input.prisma,
    routingRecords,
  });
}''',
    "scope pending contact lookup to one group",
)

provider_path = "apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts"
replace_once(
    provider_path,
    '''    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        prisma: input.prisma,
      });''',
    '''    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        linqChatId: summary.chatId,
        prisma: input.prisma,
        recipientPhone: incomingRecipientPhone,
      });''',
    "require exact pending group authority",
)
replace_once(
    provider_path,
    '''  | "empty-message-parts"
  | "local-inbound-not-allowlisted"''',
    '''  | "blocked-first-contact-content"
  | "empty-message-parts"
  | "local-inbound-not-allowlisted"''',
    "add blocked group first-contact reason",
)
insert_before(
    provider_path,
    '''  if (!sender || !senderAccessAllowed) {
''',
    '''  if (
    (!sender || !senderAccessAllowed)
    && hostedLinqFirstContactContainsBlockedContent({
      event: messageEvent,
      participantContact,
    })
  ) {
    return ignored("blocked-first-contact-content", senderIdentityMatch);
  }

''',
    "block unsafe unknown-group first contact",
)

write(
    "apps/web/app/api/groups/start/recover/route.ts",
    '''import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { openHostedLinqGroupEmailRecoveryToken } from "@/src/lib/hosted-onboarding/linq-group-setup";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(session.member);

  const body = await readOptionalJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
  });
  const token = readRecoveryToken(body.token);
  const recovery = openHostedLinqGroupEmailRecoveryToken({ token });
  if (!recovery) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 410,
      message: "That Messages recovery link is invalid or expired.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  const status = await prisma.$transaction(async (tx) => {
    await acquireHostedLinqChatOwnershipLockTx({
      chatId: recovery.chatId,
      tx,
    });
    const route = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (route) {
      return "already_connected" as const;
    }

    const verifiedEmail = await lookupHostedMemberByVerifiedEmailAddress({
      address: recovery.participantContact.value,
      prisma: tx,
    });
    if (verifiedEmail) {
      if (verifiedEmail.core.id !== session.member.id) {
        throwRecoveryConflict();
      }
      return "linked" as const;
    }

    const routing = await readHostedMemberRoutingState({
      memberId: session.member.id,
      prisma: tx,
    });
    const pendingChatId = routing?.pendingLinqChatId ?? null;
    const pendingContact = routing?.pendingLinqParticipantContact ?? null;
    const pendingRecipientPhone =
      routing?.pendingLinqRecipientPhone ?? null;
    const hasPendingBinding = Boolean(
      pendingChatId || pendingContact || pendingRecipientPhone,
    );
    const exactPendingBinding =
      pendingChatId === recovery.chatId
      && pendingContact?.lookupKey === recovery.participantContact.lookupKey
      && pendingRecipientPhone === recovery.recipientPhone;
    if (hasPendingBinding && !exactPendingBinding) {
      throwRecoveryConflict();
    }

    await upsertHostedMemberPendingLinqBindingTx({
      homeLineAssignedAt: null,
      linqChatId: recovery.chatId,
      memberId: session.member.id,
      participantContact: recovery.participantContact,
      participantContactObservedAt: recovery.observedAt,
      prisma: tx,
      recipientPhone: recovery.recipientPhone,
    });
    return "linked" as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    ok: true,
    status,
  });
});

function throwRecoveryConflict(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT",
    httpStatus: 409,
    message:
      "That Messages address is already linked to another Murph setup.",
    retryable: false,
  });
}

function readRecoveryToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 6_000
    || value !== value.trim()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 400,
      message: "A valid Messages recovery link is required.",
      retryable: false,
    });
  }
  return value;
}
''',
)

client_path = "apps/web/src/components/hosted-groups/group-start-client.tsx"
replace_once(
    client_path,
    'import { type ReactNode, useEffect, useRef, useState } from "react";',
    'import { useEffect, useRef, useState } from "react";',
    "remove inline frame type",
)
replace_once(
    client_path,
    '''import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
''',
    '''import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { HostedGroupStartFrame } from "./group-start-frame";
''',
    "import group-start frame",
)
client = read(client_path)
frame_marker = "\nfunction HostedGroupStartFrame({\n"
frame_index = client.find(frame_marker)
if frame_index < 0:
    raise RuntimeError("Missing inline group-start frame")
write(client_path, client[:frame_index].rstrip() + "\n")

write(
    "apps/web/src/components/hosted-groups/group-start-frame.tsx",
    '''import type { ReactNode } from "react";

export function HostedGroupStartFrame({
  body,
  children,
  icon,
  title,
}: {
  body: string;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-pretty text-base leading-7 text-muted-foreground">
            {body}
          </p>
        </div>
      </header>
      {children ? <div className="flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}
''',
)

write(
    "apps/web/app/design/group-start-study.tsx",
    '''import { Check, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { HostedGroupStartFrame } from "@/src/components/hosted-groups/group-start-frame";
import { Button } from "@/src/components/ui/button";

export function GroupStartStudy() {
  return (
    <div
      id="linq-unknown-group-recovery"
      data-design-section="linq-unknown-group-recovery"
      className="grid gap-6 lg:grid-cols-3"
      inert
    >
      <StudyCard>
        <HostedGroupStartFrame
          icon={<MessageCircle className="size-8" />}
          title="Set up Murph for this group"
          body="Create or open your Murph account. When setup is finished, return to the group and message Murph again."
        >
          <Button type="button" size="xl" className="w-full">
            Continue
          </Button>
        </HostedGroupStartFrame>
      </StudyCard>

      <StudyCard>
        <HostedGroupStartFrame
          icon={<MessageCircle className="size-8" />}
          title="Finish setting up Murph"
          body="Complete setup, then return to the group and message Murph again."
        >
          <Button type="button" size="xl" className="w-full">
            Finish setup
          </Button>
        </HostedGroupStartFrame>
      </StudyCard>

      <StudyCard>
        <HostedGroupStartFrame
          icon={<Check className="size-8" />}
          title="Go back to the group"
          body="Message Murph in that group again. Your next message will connect the chat and Murph will reply there."
        />
      </StudyCard>
    </div>
  );
}

function StudyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-background p-6 shadow-sm">
      {children}
    </div>
  );
}
''',
)

sections_path = "apps/web/app/design/sections-content.tsx"
replace_once(
    sections_path,
    'import { GroupJoinStudy } from "./group-join-study";',
    'import { GroupJoinStudy } from "./group-join-study";\nimport { GroupStartStudy } from "./group-start-study";',
    "import group-start design study",
)
replace_once(
    sections_path,
    '''      <StudySection title="Group join message invites, actions, and sharing consents">
        <GroupJoinStudy />
      </StudySection>

      <Separator />
''',
    '''      <StudySection title="Group join message invites, actions, and sharing consents">
        <GroupJoinStudy />
      </StudySection>

      <Separator />

      <StudySection title="Unknown iMessage group setup and recovery">
        <GroupStartStudy />
      </StudySection>

      <Separator />
''',
    "add group-start design study",
)

setup_test_path = "apps/web/test/hosted-linq-group-setup.test.ts"
insert_before(
    setup_test_path,
    '''  it("keeps the private bearer token out of the request query", () => {
''',
    '''  it("seals the same provider event to the same retry token", () => {
    const input = {
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    };

    const first = issueHostedLinqGroupEmailRecoveryToken(input);
    expect(issueHostedLinqGroupEmailRecoveryToken(input)).toBe(first);
    expect(issueHostedLinqGroupEmailRecoveryToken({
      ...input,
      chatId: "chat_group_other",
    })).not.toBe(first);
  });

''',
    "test deterministic recovery token",
)

write(
    "apps/web/test/hosted-group-start-recovery-route.test.ts",
    '''import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  openHostedLinqGroupEmailRecoveryToken: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx:
    mocks.upsertHostedMemberPendingLinqBindingTx,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-group-setup", () => ({
  openHostedLinqGroupEmailRecoveryToken:
    mocks.openHostedLinqGroupEmailRecoveryToken,
}));
vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

let route: typeof import("../app/api/groups/start/recover/route");
const tx = { tx: true };
const recovery = {
  chatId: "chat_group_123",
  observedAt: new Date("2026-07-31T04:00:00.000Z"),
  participantContact: {
    kind: "email" as const,
    lookupKey: "contact_lookup_key",
    value: "person@icloud.com",
  },
  recipientPhone: "+15550000000",
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_existing", suspendedAt: null },
  });
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValue(recovery);
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
  mocks.acquireHostedLinqChatOwnershipLockTx.mockResolvedValue(undefined);
  mocks.upsertHostedMemberPendingLinqBindingTx.mockResolvedValue(undefined);
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
  });
  route = await import("../app/api/groups/start/recover/route");
});

function buildRequest(token = "sealed_recovery_token") {
  return new Request("https://murph.example/api/groups/start/recover", {
    body: JSON.stringify({ token }),
    headers: {
      "content-type": "application/json",
      origin: "https://murph.example",
    },
    method: "POST",
  });
}

test("records one exact temporary sender bridge without creating a group", async () => {
  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.acquireHostedLinqChatOwnershipLockTx).toHaveBeenCalledWith({
    chatId: recovery.chatId,
    tx,
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledWith({
    homeLineAssignedAt: null,
    linqChatId: recovery.chatId,
    memberId: "member_existing",
    participantContact: recovery.participantContact,
    participantContactObservedAt: recovery.observedAt,
    prisma: tx,
    recipientPhone: recovery.recipientPhone,
  });
});

test("does not mutate an already connected group", async () => {
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
    containerMemberId: "group_runtime",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "already_connected",
  });
  expect(mocks.lookupHostedMemberByVerifiedEmailAddress).not.toHaveBeenCalled();
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("uses an existing verified email on the same account without a pending bridge", async () => {
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValueOnce({
    core: { id: "member_existing" },
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("refuses a Messages email already owned by another account", async () => {
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValueOnce({
    core: { id: "member_other" },
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("refuses to overwrite another pending Messages setup", async () => {
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    pendingLinqChatId: "chat_other",
    pendingLinqParticipantContact: {
      kind: "email",
      lookupKey: "other_contact",
      value: "other@example.com",
    },
    pendingLinqRecipientPhone: "+15559999999",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("accepts an idempotent exact pending Messages setup", async () => {
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    pendingLinqChatId: recovery.chatId,
    pendingLinqParticipantContact: recovery.participantContact,
    pendingLinqRecipientPhone: recovery.recipientPhone,
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledTimes(1);
});

test("rejects an expired or malformed recovery token", async () => {
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValueOnce(null);

  const response = await route.POST(buildRequest("expired"));

  expect(response.status).toBe(410);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID" },
  });
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});
''',
)

write(
    "apps/web/test/hosted-member-routing-pending-group.test.ts",
    '''import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "../src/lib/hosted-onboarding/contact-privacy";
import { lookupHostedMemberRoutingByPendingLinqParticipantContact } from "../src/lib/hosted-onboarding/hosted-member-routing-store";
import { createHostedLinqParticipantContact } from "../src/lib/hosted-onboarding/linq-participant-contact";

describe("pending Linq group contact lookup", () => {
  it("scopes one temporary identity to the exact chat and recipient line", async () => {
    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "person@icloud.com",
    });
    if (!contact) {
      throw new Error("Expected email contact");
    }
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedMemberRouting: { findMany },
    };

    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact,
      linqChatId: "chat_group_123",
      prisma: prisma as never,
      recipientPhone: "+15550000000",
    });

    expect(findMany).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: {
        pendingLinqChatLookupKey: {
          in: createHostedLinqChatLookupKeyReadCandidates("chat_group_123"),
        },
        pendingLinqParticipantContactLookupKey: {
          in: expect.arrayContaining([contact.lookupKey]),
        },
        pendingLinqRecipientPhoneLookupKey: {
          in: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
        },
      },
    });
  });

  it("rejects a partially scoped group lookup", async () => {
    const contact = createHostedLinqParticipantContact({
      kind: "email",
      value: "person@icloud.com",
    });
    if (!contact) {
      throw new Error("Expected email contact");
    }

    await expect(
      lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact,
        linqChatId: "chat_group_123",
        prisma: { hostedMemberRouting: { findMany: vi.fn() } } as never,
      }),
    ).rejects.toThrow(
      "Pending Linq group contact lookup requires both chat and recipient line.",
    );
  });
});
''',
)

thread_test_path = "apps/web/test/hosted-onboarding-linq-thread-route.test.ts"
replace_once(
    thread_test_path,
    '''    ).toHaveBeenCalledWith({
      contact: expect.objectContaining({
        kind: "email",
        value: "incident-sender@example.com",
      }),
      prisma,
    });''',
    '''    ).toHaveBeenCalledWith({
      contact: expect.objectContaining({
        kind: "email",
        value: "incident-sender@example.com",
      }),
      linqChatId: "chat_group_123",
      prisma,
      recipientPhone: "+15550000000",
    });''',
    "assert exact recovered group lookup",
)
insert_before(
    thread_test_path,
    '''  it("provisions normally after private email recovery links the sender", async () => {
''',
    '''  it("does not answer a standalone SMS opt-out command in an unknown group", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        service: "sms",
        text: "STOP",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(plan.desiredSideEffects).toEqual([]);
  });

''',
    "test unknown group opt-out guard",
)

write(
    "agent-docs/exec-plans/completed/2026-07-31-unknown-linq-group-setup-recovery.md",
    '''# Unknown Linq group setup recovery

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

Let an otherwise valid but unrouted iMessage group recover when its first sender
is not yet an active recognized Murph member, including the case where Apple
Messages sends from an email address instead of the member's phone number.

## Design

- Keep the existing invariant that only a later inbound message from an active,
  recognized member provisions the thread container.
- Send one idempotent setup link in an unknown group. Clicking it only signs in
  or signs up; it never claims or connects the group.
- Use one expiring same-tab browser handoff so the existing auto-trial or Stripe
  success client returns completed setup to the group instruction page. Billing
  APIs and durable account state remain unchanged.
- For an unknown iMessage email sender, send a private 24-hour encrypted
  recovery link from the same healthy managed line. Keep its bearer token in the
  URL fragment so it does not enter request logs or referrers.
- Derive that encrypted token deterministically from the stable provider event,
  with separate encryption and nonce keys, so one Linq idempotency key always
  carries identical message bytes on retry.
- Reuse `HostedMemberRouting.pendingLinqParticipantContact` as the temporary
  identity bridge, but resolve it only when its email, group chat id, and Murph
  recipient line all match the new inbound. The existing group demotion clears
  that exact temporary binding after route creation.
- Serialize private recovery against group route creation with the existing Linq
  chat ownership lock and reject a verified email already owned by another
  account.
- Add no schema, alias table, group claim, connect button, ownership transfer,
  queue, cron, or message backfill.

## Verification

- Focused token, browser handoff, recovery-route, exact pending-routing, and
  group planner tests.
- `apps/web` typecheck and diff-aware repository verification in CI.
''',
)

desktop_svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <rect width="1440" height="900" fill="#f5f1e8"/>
  <text x="72" y="72" font-family="ui-monospace, monospace" font-size="16" letter-spacing="2" fill="#6b6a66">UNKNOWN IMESSAGE GROUP SETUP · DESKTOP</text>
  <g transform="translate(72 138)">
    <rect width="396" height="590" rx="30" fill="#fffdf8" stroke="#d8d2c6"/>
    <rect x="166" y="62" width="64" height="64" rx="16" fill="#e8eee6"/>
    <circle cx="198" cy="94" r="13" fill="none" stroke="#365c48" stroke-width="4"/>
    <path d="M189 105l-3 10 11-6" fill="none" stroke="#365c48" stroke-width="4" stroke-linecap="round"/>
    <text x="198" y="172" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">Set up Murph</text>
    <text x="198" y="208" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">for this group</text>
    <text x="198" y="258" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">Create or open your Murph account.</text>
    <text x="198" y="286" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">Then return to the group and</text>
    <text x="198" y="314" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">message Murph again.</text>
    <rect x="42" y="474" width="312" height="58" rx="15" fill="#294d3c"/>
    <text x="198" y="510" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#ffffff">Continue</text>
  </g>
  <g transform="translate(522 138)">
    <rect width="396" height="590" rx="30" fill="#fffdf8" stroke="#d8d2c6"/>
    <rect x="166" y="62" width="64" height="64" rx="16" fill="#e8eee6"/>
    <circle cx="198" cy="94" r="13" fill="none" stroke="#365c48" stroke-width="4"/>
    <path d="M189 105l-3 10 11-6" fill="none" stroke="#365c48" stroke-width="4" stroke-linecap="round"/>
    <text x="198" y="172" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">Finish setting</text>
    <text x="198" y="208" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">up Murph</text>
    <text x="198" y="258" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">Complete setup, then return to the</text>
    <text x="198" y="286" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">group and message Murph again.</text>
    <rect x="42" y="474" width="312" height="58" rx="15" fill="#294d3c"/>
    <text x="198" y="510" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#ffffff">Finish setup</text>
  </g>
  <g transform="translate(972 138)">
    <rect width="396" height="590" rx="30" fill="#fffdf8" stroke="#d8d2c6"/>
    <rect x="166" y="62" width="64" height="64" rx="16" fill="#e8eee6"/>
    <path d="M183 95l10 10 22-25" fill="none" stroke="#365c48" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="198" y="172" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">Go back to</text>
    <text x="198" y="208" text-anchor="middle" font-family="Georgia, serif" font-size="29" font-weight="600" fill="#252a27">the group</text>
    <text x="198" y="258" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">Message Murph in that group again.</text>
    <text x="198" y="286" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b6a66">Your next message connects the chat.</text>
  </g>
</svg>
'''
mobile_svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="430" height="932" viewBox="0 0 430 932">
  <rect width="430" height="932" fill="#f5f1e8"/>
  <text x="24" y="42" font-family="ui-monospace, monospace" font-size="11" letter-spacing="1.4" fill="#6b6a66">UNKNOWN IMESSAGE GROUP SETUP · MOBILE</text>
  <g transform="translate(20 78)">
    <rect width="390" height="728" rx="30" fill="#fffdf8" stroke="#d8d2c6"/>
    <rect x="163" y="92" width="64" height="64" rx="16" fill="#e8eee6"/>
    <path d="M180 125l10 10 22-25" fill="none" stroke="#365c48" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="195" y="221" text-anchor="middle" font-family="Georgia, serif" font-size="32" font-weight="600" fill="#252a27">Go back to</text>
    <text x="195" y="260" text-anchor="middle" font-family="Georgia, serif" font-size="32" font-weight="600" fill="#252a27">the group</text>
    <text x="195" y="326" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#6b6a66">Message Murph in that group again.</text>
    <text x="195" y="358" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#6b6a66">Your next message will connect the</text>
    <text x="195" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#6b6a66">chat and Murph will reply there.</text>
    <rect x="34" y="562" width="322" height="1" fill="#e4dfd5"/>
    <text x="195" y="612" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" letter-spacing="1.5" fill="#7a786f">NO CONNECT BUTTON</text>
    <text x="195" y="648" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#6b6a66">The next recognized group message</text>
    <text x="195" y="676" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#6b6a66">uses the existing provisioning path.</text>
  </g>
</svg>
'''
write("agent-docs/design-proof/linq-unknown-group-desktop.svg", desktop_svg)
write("agent-docs/design-proof/linq-unknown-group-mobile.svg", mobile_svg)
