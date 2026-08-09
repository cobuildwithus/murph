from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected exactly one replacement target, found {count}: {old[:180]!r}"
        )
    write(path, text.replace(old, new, 1))


def replace_exact_count(path: str, old: str, new: str, expected: int) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise RuntimeError(
            f"{path}: expected {expected} replacement targets, found {count}: {old[:180]!r}"
        )
    write(path, text.replace(old, new))


def replace_block(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{path}: missing block start {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{path}: missing block end {end_marker!r}")
    write(path, text[:start] + replacement + text[end:])


def replace_to_eof(path: str, start_marker: str, replacement: str) -> None:
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{path}: missing tail start {start_marker!r}")
    write(path, text[:start] + replacement)


def replace_once_in_block(
    path: str,
    block_start: str,
    block_end: str,
    old: str,
    new: str,
) -> None:
    text = read(path)
    start = text.find(block_start)
    if start < 0:
        raise RuntimeError(f"{path}: missing scoped block start {block_start!r}")
    end = text.find(block_end, start)
    if end < 0:
        raise RuntimeError(f"{path}: missing scoped block end {block_end!r}")
    block = text[start:end]
    count = block.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected one scoped replacement, found {count}: {old[:180]!r}"
        )
    write(path, text[:start] + block.replace(old, new, 1) + text[end:])


def replace_exact_count_in_block(
    path: str,
    block_start: str,
    block_end: str,
    old: str,
    new: str,
    expected: int,
) -> None:
    text = read(path)
    start = text.find(block_start)
    if start < 0:
        raise RuntimeError(f"{path}: missing scoped block start {block_start!r}")
    end = text.find(block_end, start)
    if end < 0:
        raise RuntimeError(f"{path}: missing scoped block end {block_end!r}")
    block = text[start:end]
    count = block.count(old)
    if count != expected:
        raise RuntimeError(
            f"{path}: expected {expected} scoped replacements, found {count}: {old[:180]!r}"
        )
    write(path, text[:start] + block.replace(old, new) + text[end:])


RUNTIME_CONTROL = "packages/hosted-execution/src/runtime-control.ts"
RUNTIME_PARSER = "packages/hosted-execution/src/parsers/runtime-control.ts"
PARSER_TEST = "packages/hosted-execution/test/generated-contact-card-parser.test.ts"
GROUP_TOOL = "apps/web/src/lib/hosted-groups/group-tool.ts"
GROUP_TOOL_TEST = "apps/web/test/hosted-group-tool.test.ts"
CONTACT_CARD_SHARE = "apps/web/src/lib/hosted-onboarding/linq-contact-card-share.ts"
CONTACT_CARD_SHARE_TEST = "apps/web/test/hosted-onboarding-linq-contact-card-share.test.ts"
LINQ_CLIENT = "apps/web/src/lib/hosted-onboarding/linq-client.ts"
LINQ_IDEMPOTENCY_TEST = "apps/web/test/hosted-onboarding-linq-attachment-idempotency.test.ts"
WORKSPACE_PHASE = "packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts"
WORKSPACE_PHASE_TEST = "packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts"
OPERATION_SCOPE_TEST = "packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts"
EXEC_PLAN = "agent-docs/exec-plans/completed/2026-08-08-generated-murph-contact-card.md"


# The pre-bind assistant request may omit only the direct chat id. Image and
# accepted-request identity are a pair, and a personalized request can never
# carry group-thread authority.
replace_once(
    RUNTIME_CONTROL,
    '''  | {
      action: "share_contact_card";
      contactCardImageUrl?: string;
      contactCardShareKey?: string;
      /**
       * Trusted-host chat id for a personalized card in a direct conversation.
       * Direct routes are owned by the member's own routing record rather than
       * the group thread-route store, so they carry no thread authority here
       * and Web revalidates the chat against that owner before sending.
       */
      directLinqChatId?: string;
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
''',
    '''  | {
      action: "share_contact_card";
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
  | {
      action: "share_contact_card";
      contactCardImageUrl: string;
      contactCardShareKey: string;
      /**
       * Injected by the trusted turn-context wrapper before transport. It is
       * optional only in the pre-bind assistant request; the runtime parser
       * requires it before Web may see the personalized variant.
       */
      directLinqChatId?: string;
    }
''',
)

# The RPC parser is the transport trust boundary: canonical and personalized
# requests are exact, mutually exclusive shapes. Partial or mixed authority is
# rejected before the Web handler can choose an authorization path.
replace_block(
    RUNTIME_PARSER,
    '  if (action === "share_contact_card") {\n',
    '  if (action === "revoke_own_email_share") {\n',
    '''  if (action === "share_contact_card") {
    const label = "Hosted runtime group tool share_contact_card request";
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "contactCardImageUrl",
        "contactCardShareKey",
        "directLinqChatId",
        "linqThread",
      ]),
      label,
    );
    const hasContactCardImageUrl = record.contactCardImageUrl !== undefined
      && record.contactCardImageUrl !== null;
    const hasContactCardShareKey = record.contactCardShareKey !== undefined
      && record.contactCardShareKey !== null;
    const hasDirectLinqChatId = record.directLinqChatId !== undefined
      && record.directLinqChatId !== null;
    const personalizedFieldCount = Number(hasContactCardImageUrl)
      + Number(hasContactCardShareKey)
      + Number(hasDirectLinqChatId);

    if (personalizedFieldCount === 0) {
      if (record.linqThread === undefined || record.linqThread === null) {
        return { action };
      }
      return {
        action,
        linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
          record.linqThread,
          `${label} linqThread`,
        ),
      };
    }

    if (
      personalizedFieldCount !== 3
      || (record.linqThread !== undefined && record.linqThread !== null)
    ) {
      throw new TypeError(
        `${label} must be either canonical with optional linqThread, or personalized with contactCardImageUrl, contactCardShareKey, and directLinqChatId only.`,
      );
    }

    return {
      action,
      contactCardImageUrl: parseHostedRuntimeGroupChatIconUrl(
        record.contactCardImageUrl,
        options.privateMediaDeliveryOrigin,
        `${label} contactCardImageUrl`,
      ),
      contactCardShareKey: parseHostedRuntimeGroupAskBoundedText({
        label: `${label} contactCardShareKey`,
        maxCodePoints:
          HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS,
        value: record.contactCardShareKey,
      }),
      directLinqChatId: parseHostedRuntimeGroupAskBoundedText({
        label: `${label} directLinqChatId`,
        maxCodePoints:
          HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS,
        value: record.directLinqChatId,
      }),
    };
  }
''',
)

write(
    PARSER_TEST,
    '''import { describe, expect, it } from "vitest";

import { parseHostedRuntimeGroupToolRequest } from "../src/parsers.ts";

const PRIVATE_MEDIA_ORIGIN =
  "https://murph-hosted.cobuildwithus.workers.dev";
const CONTACT_CARD_IMAGE_URL =
  `${PRIVATE_MEDIA_ORIGIN}/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
const LINQ_THREAD = {
  authority: {
    accountLookupKey: "hplk_current_line",
    channel: "linq" as const,
    containerMemberId: "member_group",
    threadId: "chat_group_1",
  },
  chatId: "chat_group_1",
};

const parse = (request: unknown) =>
  parseHostedRuntimeGroupToolRequest(request, {
    privateMediaDeliveryOrigin: PRIVATE_MEDIA_ORIGIN,
  });

describe("generated contact-card runtime request", () => {
  it("accepts the canonical group variant with optional exact thread authority", () => {
    expect(parse({ action: "share_contact_card" })).toEqual({
      action: "share_contact_card",
    });
    expect(parse({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    })).toEqual({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    });
  });

  it("accepts only the complete bound personalized variant", () => {
    expect(parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    })).toEqual({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    });
  });

  it.each([
    {
      label: "image without a share key or direct chat",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      },
    },
    {
      label: "image and share key without a direct chat",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
        contactCardShareKey: "asst_input_abc123",
      },
    },
    {
      label: "share key and direct chat without an image",
      request: {
        action: "share_contact_card",
        contactCardShareKey: "asst_input_abc123",
        directLinqChatId: "chat_direct_1",
      },
    },
    {
      label: "personalized fields mixed with group authority",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
        contactCardShareKey: "asst_input_abc123",
        directLinqChatId: "chat_direct_1",
        linqThread: LINQ_THREAD,
      },
    },
  ])("rejects $label", ({ request }) => {
    expect(() => parse(request)).toThrow(/must be either canonical/u);
  });

  it("bounds both trusted-host identifiers", () => {
    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "a".repeat(201),
      directLinqChatId: "chat_direct_1",
    })).toThrow(/contactCardShareKey/u);

    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "c".repeat(201),
    })).toThrow(/directLinqChatId/u);
  });

  it("rejects untrusted image origins and model-only fields", () => {
    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: "https://example.invalid/avatar.png",
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    })).toThrow(/contactCardImageUrl is invalid/u);

    expect(() => parse({
      action: "share_contact_card",
      avatarPrompt: "model-only field",
    })).toThrow(/avatarPrompt is not allowed/u);
  });
});
''',
)

# Keep the shared action declaration conservative. The direct personalized
# variant owns its explicit direct-route authorization in its own branch.
replace_once(
    GROUP_TOOL,
    '  share_contact_card: "participant_aware",\n',
    '  share_contact_card: "owner_active",\n',
)

replace_once(
    GROUP_TOOL,
    '''  if (input.request.action === "share_contact_card") {
    return handleHostedRuntimeGroupShareContactCard({
      contactCardImageUrl: input.request.contactCardImageUrl ?? null,
      contactCardShareKey: input.request.contactCardShareKey ?? null,
      directLinqChatId: input.request.directLinqChatId ?? null,
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }
''',
    '''  if (input.request.action === "share_contact_card") {
    if ("contactCardImageUrl" in input.request) {
      if (!input.request.directLinqChatId) {
        return {
          action: "share_contact_card",
          result: {
            status: "unavailable",
            unavailableReason: "direct_attachment_route_unavailable",
          },
        };
      }
      return handleHostedRuntimeGroupShareContactCard({
        kind: "personalized",
        contactCardImageUrl: input.request.contactCardImageUrl,
        contactCardShareKey: input.request.contactCardShareKey,
        directLinqChatId: input.request.directLinqChatId,
        memberId: input.memberId,
      });
    }
    return handleHostedRuntimeGroupShareContactCard({
      kind: "canonical",
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }
''',
)

replace_to_eof(
    GROUP_TOOL,
    'async function handleHostedRuntimeGroupShareContactCard(input: {\n',
    '''type HostedRuntimeGroupShareContactCardInput =
  | {
      kind: "canonical";
      linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
      memberId: string;
    }
  | {
      kind: "personalized";
      contactCardImageUrl: string;
      contactCardShareKey: string;
      directLinqChatId: string;
      memberId: string;
    };

async function handleHostedRuntimeGroupShareContactCard(
  input: HostedRuntimeGroupShareContactCardInput,
): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "share_contact_card",
    result: { status: "unavailable", unavailableReason },
  });

  const authorized = input.kind === "personalized"
    ? await authorizeHostedRuntimeDirectLinqChat({
      chatId: input.directLinqChatId,
      memberId: input.memberId,
    })
    : await authorizeHostedRuntimeGroupLinqThread({
      linqThread: input.linqThread,
      memberId: input.memberId,
    });
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  const prisma = getPrisma();
  let outcome: Awaited<ReturnType<typeof shareMurphHostedLinqContactCardVcfToChat>>;
  if (input.kind === "personalized") {
    const contactCardImageUrl = normalizeHostedGroupChatIconUrl(
      input.contactCardImageUrl,
    );
    if (!contactCardImageUrl) {
      return unavailable("contact_card_image_url_unavailable");
    }
    outcome = await shareMurphHostedLinqContactCardVcfToChat({
      chatId: authorized.chatId,
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl: contactCardImageUrl,
      memberId: input.memberId,
      prisma,
      // Stable trusted-host request identity: retries collapse at the provider,
      // while a distinct request gets a distinct send identity immediately.
      shareKey: input.contactCardShareKey,
    });
  } else {
    const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
      memberId: input.memberId,
      prisma,
    });
    if (ownerAccess.status !== "ok") {
      return unavailable(ownerAccess.unavailableReason);
    }
    outcome = await shareMurphHostedLinqContactCardVcfToChat({
      chatId: authorized.chatId,
      idempotencyKeyPrefix: "group-contact-card",
      memberId: input.memberId,
      prisma,
    });
  }

  if (outcome.status === "already_shared") {
    return {
      action: "share_contact_card",
      result: { status: "already_shared" },
    };
  }
  if (outcome.status !== "sent") {
    return unavailable(outcome.reason);
  }

  return {
    action: "share_contact_card",
    result: { status: "sent" },
  };
}
''',
)

# Personalized composition is one exact pair: generated image URL plus stable
# accepted-request send key. Canonical shares alone retain the wall-clock
# reservation owner.
replace_to_eof(
    CONTACT_CARD_SHARE,
    '''/**
 * Share Murph's first-party vCard into a Linq chat as an attachment.''',
    '''type MurphHostedLinqContactCardVcfShareInput = {
  chatId: string;
  idempotencyKeyPrefix: string;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
} & (
  | { imageUrl: string; shareKey: string }
  | { imageUrl?: never; shareKey?: never }
);

/**
 * Share Murph's first-party vCard into a Linq chat as an attachment. This is
 * the discretionary group-tool mechanism and never calls Linq's native
 * contact-card share. Callers own eligibility and thread authority. Canonical
 * sends retain the shared reservation; personalized sends carry one stable
 * accepted-request provider identity instead. Send failures are returned, not
 * thrown.
 */
export async function shareMurphHostedLinqContactCardVcfToChat(
  input: MurphHostedLinqContactCardVcfShareInput,
): Promise<MurphHostedLinqContactCardVcfShareOutcome> {
  let personalized: { imageUrl: string; shareKey: string } | null;
  if (input.imageUrl === undefined && input.shareKey === undefined) {
    personalized = null;
  } else if (input.imageUrl !== undefined && input.shareKey !== undefined) {
    personalized = {
      imageUrl: input.imageUrl,
      shareKey: input.shareKey,
    };
  } else {
    throw new TypeError(
      "Personalized contact-card imageUrl and shareKey must be provided together.",
    );
  }

  // A personalized card is saved over the member's working Murph contact, so
  // an obsolete or ambiguous line is worse than no card. Require exactly one
  // active self handle, matching the native line-card path.
  let linePhoneNumber: string | null = null;
  let rosterPresent = false;
  try {
    const handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    rosterPresent = handles.length > 0;
    if (personalized) {
      const activeSelfHandles = handles.filter((handle) =>
        handle.isMe && handle.status?.trim().toLowerCase() === "active",
      );
      linePhoneNumber = activeSelfHandles.length === 1
        ? normalizePhoneNumber(activeSelfHandles[0]?.handle ?? null)
        : null;
    } else {
      linePhoneNumber = normalizePhoneNumber(
        handles.find((handle) => handle.isMe)?.handle ?? null,
      );
    }
  } catch {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!rosterPresent) {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!linePhoneNumber) {
    return { status: "skipped", reason: "line_unresolved" };
  }

  let reservation: Extract<
    HostedLinqContactCardShareReserveDecision,
    { action: "share" }
  > | null = null;
  if (!personalized) {
    const decision = await reserveHostedLinqContactCardShareAttempt({
      chatId: input.chatId,
      memberId: input.memberId,
      ...(input.now ? { now: input.now } : {}),
      prisma: input.prisma,
    });
    if (decision.action !== "share") {
      return decision.reason === "recent_attempt"
        ? { status: "already_shared" }
        : { status: "skipped", reason: decision.reason };
    }
    reservation = decision;
  }

  const [photo, backupPhoneNumber] = await Promise.all([
    personalized
      ? fetchMurphHostedLinqContactCardVcfPhoto({
          imageUrl: personalized.imageUrl,
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : fetchMurphHostedLinqContactCardVcfPhoto(
          input.signal ? { signal: input.signal } : {},
        ),
    resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: linePhoneNumber,
      prisma: input.prisma,
    }),
  ]);
  if (personalized && !photo) {
    // A personalized card without its generated photo would falsely report
    // success for the exact thing the member requested. Personalized sends own
    // no reservation, so a later retry can proceed immediately.
    return { status: "skipped", reason: "photo_unavailable" };
  }

  const providerIdempotencyKey = personalized
    ? `${input.idempotencyKeyPrefix}:${input.chatId}:${personalized.shareKey}`
    : reservation
      ? `${input.idempotencyKeyPrefix}:${input.chatId}:${reservation.attemptedAt.getTime()}`
      : null;
  if (!providerIdempotencyKey) {
    throw new Error("Contact-card send identity is unavailable.");
  }

  const vcf = buildMurphHostedLinqContactCardVcf({
    backupPhoneNumber,
    phoneNumber: linePhoneNumber,
    photo,
  });
  try {
    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array(Buffer.from(vcf, "utf8")),
      chatId: input.chatId,
      contentType: MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
      fileName: MURPH_CONTACT_CARD_VCF_FILE_NAME,
      idempotencyKey: providerIdempotencyKey,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    // A replay of this exact accepted request: the provider proved the key was
    // already accepted with a different attachment body, so the card is
    // already in the chat. Canonical reservation keys do not prove that intent.
    if (personalized && isHostedLinqIdempotencyKeyReuseFailure(error)) {
      return { status: "already_shared" };
    }
    if (reservation && isHostedLinqAttachmentSendPrepareFailure(error)) {
      // Nothing reached the chat; free the canonical throttle reservation so a
      // later retry is not locked out. Ambiguous message-send failures keep it.
      try {
        await releaseHostedLinqContactCardShareAttempt({
          attemptedAt: reservation.attemptedAt,
          chatId: input.chatId,
          memberId: input.memberId,
          prisma: input.prisma,
        });
      } catch {
        // Best effort: a stuck reservation only delays the next attempt.
      }
    }
    return { status: "failed", reason: "send_failed", error };
  }

  return { status: "sent" };
}
''',
)

# Match the exact provider error shape promised by the comment. A generic 409
# or a larger message merely containing the words must not prove delivery.
replace_block(
    LINQ_CLIENT,
    "const HOSTED_LINQ_IDEMPOTENCY_CONFLICT_PATTERN =\n",
    "/**\n * True only when the provider rejected a reused idempotency key",
    '''const HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Conflicting Linq idempotency-key reuse.";

/**
 * Exact reader for the provider's same-key/different-payload conflict. A
 * generic 409 or a wrapped message must not be mistaken for proven delivery.
 */
async function isHostedLinqIdempotencyKeyReuseConflict(
  response: Response,
): Promise<boolean> {
  const payload = await readHostedLinqOptionalJsonResponse<{
    error?: unknown;
  }>(response.clone());
  return payload?.error === HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE;
}

''',
)

# A missing or ambiguous route should fail cleanly in the trusted wrapper rather
# than forwarding an intentionally unbound personalized transport request.
replace_once(
    WORKSPACE_PHASE,
    '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : await forwardRequest(request);
''',
    '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : {
            action: "share_contact_card",
            result: {
              status: "unavailable",
              unavailableReason: "direct_attachment_route_unavailable",
            },
          };
''',
)

# Web handler regression coverage and conservative classification.
replace_once(
    GROUP_TOOL_TEST,
    '      share_contact_card: "participant_aware",\n',
    '      share_contact_card: "owner_active",\n',
)
replace_exact_count(
    GROUP_TOOL_TEST,
    '''        contactCardImageUrl,
        directLinqChatId: "chat_direct_1",
''',
    '''        contactCardImageUrl,
        contactCardShareKey: "input_direct_1",
        directLinqChatId: "chat_direct_1",
''',
    2,
)
replace_once(
    GROUP_TOOL_TEST,
    '''        imageUrl: contactCardImageUrl,
        memberId: "member_container",
''',
    '''        imageUrl: contactCardImageUrl,
        memberId: "member_container",
        shareKey: "input_direct_1",
''',
)
replace_once(
    GROUP_TOOL_TEST,
    '''        contactCardImageUrl: "https://example.invalid/avatar.png",
        directLinqChatId: "chat_direct_1",
''',
    '''        contactCardImageUrl: "https://example.invalid/avatar.png",
        contactCardShareKey: "input_direct_1",
        directLinqChatId: "chat_direct_1",
''',
)
replace_once(
    GROUP_TOOL_TEST,
    '''  it("rejects an untrusted generated contact-card image URL before fetching it", async () => {
''',
    '''  it("fails closed before group authorization when a personalized request lacks direct binding", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl,
        contactCardShareKey: "input_direct_1",
        linqThread: LINQ_THREAD,
      } as never,
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
    });

    expect(mocks.assertHostedLinqRecentInboundEngagementForRuntime)
      .not.toHaveBeenCalled();
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
  });

  it("rejects an untrusted generated contact-card image URL before fetching it", async () => {
''',
)

# The composer itself also enforces the image/send-key pair and uses the stable
# request identity in every personalized test.
replace_once_in_block(
    CONTACT_CARD_SHARE_TEST,
    '  it("fetches and embeds a caller-provided generated contact photo"',
    '  it("does not send a personalized card when its generated photo is unavailable"',
    '''      prisma: prisma.client as never,
      signal,
''',
    '''      prisma: prisma.client as never,
      shareKey: "input_first",
      signal,
''',
)
replace_once_in_block(
    CONTACT_CARD_SHARE_TEST,
    '  it("fetches and embeds a caller-provided generated contact photo"',
    '  it("does not send a personalized card when its generated photo is unavailable"',
    '''        idempotencyKey: `personalized-contact-card:chat_123:${now.getTime()}`,
''',
    '''        idempotencyKey: "personalized-contact-card:chat_123:input_first",
''',
)
replace_block(
    CONTACT_CARD_SHARE_TEST,
    '  it("reads a replay\'s provider key conflict as already sent, and nothing else", async () => {\n',
    '  it("refuses a personalized card when the current Murph line is stale or ambiguous", async () => {\n',
    '''  it("reads only a personalized replay's exact provider conflict as already sent", async () => {
    const prisma = createContactCardSharePrismaStub();
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "aGVsbG8=",
      type: "JPEG",
    });
    const personalizedShare = () =>
      shareMurphHostedLinqContactCardVcfToChat({
        chatId: "chat_123",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl,
        memberId: "member_123",
        prisma: prisma.client as never,
        shareKey: "input_first",
      });

    const conflict = Object.assign(new Error("conflict"), {
      details: { idempotencyKeyReuseConflict: true, status: 409 },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(conflict);
    await expect(personalizedShare()).resolves.toEqual({
      status: "already_shared",
    });

    // A canonical reservation identity does not prove the same user intent.
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(conflict);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_456",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: createContactCardSharePrismaStub().client as never,
    })).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: conflict,
    });

    const otherFailure = Object.assign(new Error("boom"), {
      details: { status: 409 },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(otherFailure);
    await expect(personalizedShare()).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: otherFailure,
    });
  });

  it("rejects a partial personalized composer input before provider work", async () => {
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl:
        "https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/avatar.jpg",
      memberId: "member_123",
      prisma: createContactCardSharePrismaStub().client as never,
    } as never)).rejects.toThrow(/imageUrl and shareKey must be provided together/u);

    expect(shareSendMocks.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

''',
)

# Exact conflict recognition must not accept a message that merely contains the
# provider phrase.
replace_once(
    LINQ_IDEMPOTENCY_TEST,
    '''    const serverError = await sendWithFinalResponse(
      jsonResponse(500, JSON.stringify({ error: "boom" })),
    );
''',
    '''    const wrappedConflict = await sendWithFinalResponse(
      jsonResponse(409, JSON.stringify({
        error: "Proxy wrapped: Conflicting Linq idempotency-key reuse.",
      })),
    );
    expect(wrappedConflict).toBeInstanceOf(Error);
    expect(isHostedLinqIdempotencyKeyReuseFailure(wrappedConflict)).toBe(false);

    const serverError = await sendWithFinalResponse(
      jsonResponse(500, JSON.stringify({ error: "boom" })),
    );
''',
)

# The trusted runtime wrapper always injects the complete direct binding, and
# refuses missing/ambiguous routes locally rather than forwarding a partial RPC.
replace_exact_count_in_block(
    WORKSPACE_PHASE_TEST,
    '  it("binds personalized contact cards to the exact direct iMessage chat"',
    '  it("rejects personalized contact cards on direct SMS before Web delivery"',
    '''      contactCardImageUrl,
''',
    '''      contactCardImageUrl,
      contactCardShareKey: "input_direct_1",
''',
    2,
)
replace_once_in_block(
    WORKSPACE_PHASE_TEST,
    '  it("rejects personalized contact cards on direct SMS before Web delivery"',
    '  it("does not choose between two direct iMessage routes for a personalized card"',
    '''      contactCardImageUrl,
''',
    '''      contactCardImageUrl,
      contactCardShareKey: "input_direct_sms",
''',
)
replace_block(
    WORKSPACE_PHASE_TEST,
    '  it("does not choose between two direct iMessage routes for a personalized card", async () => {\n',
    '  it("fails closed when the turn carries two distinct route-authorized threads", async () => {\n',
    '''  it("does not choose between two direct iMessage routes for a personalized card", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            threadId: "chat_direct_1",
          },
          target: "chat_direct_1",
          threadIsDirect: true,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000002",
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            threadId: "chat_direct_2",
          },
          target: "chat_direct_2",
          threadIsDirect: true,
        }),
      ],
    });

    await expect(groupTool.request({
      action: "share_contact_card",
      contactCardImageUrl,
      contactCardShareKey: "input_direct_ambiguous",
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
    });

    expect(request).not.toHaveBeenCalled();
  });

''',
)

# The full operation-scope proof now demonstrates that an unbound group input
# never crosses the runtime port.
replace_once(
    OPERATION_SCOPE_TEST,
    '''      // A group input must not read as a direct attachment route.
      await runShare(groupInput.inputId);
''',
    '''      // A group input must not read as a direct attachment route or
      // forward a partial personalized transport request.
      await expect(runShare(groupInput.inputId)).resolves.toEqual({
        action: "share_contact_card",
        result: {
          status: "unavailable",
          unavailableReason: "direct_attachment_route_unavailable",
        },
      });
''',
)
replace_once(
    OPERATION_SCOPE_TEST,
    '''      expect(contactCardRequests).toEqual([
        // The trusted host's exact direct chat, carried without any group
        // thread-route authority, which a direct home chat cannot have.
        {
          action: "share_contact_card",
          contactCardImageUrl,
          contactCardShareKey: directInput.inputId,
          directLinqChatId: "chat_direct_contact_card",
        },
        // No direct route, so nothing binds a chat and Web fails closed.
        {
          action: "share_contact_card",
          contactCardImageUrl,
          contactCardShareKey: groupInput.inputId,
        },
      ]);
''',
    '''      expect(contactCardRequests).toEqual([
        // The trusted host's exact direct chat, carried without any group
        // thread-route authority, which a direct home chat cannot have.
        {
          action: "share_contact_card",
          contactCardImageUrl,
          contactCardShareKey: directInput.inputId,
          directLinqChatId: "chat_direct_contact_card",
        },
      ]);
''',
)

# Keep the completed plan aligned with the actual ownership model and proof.
replace_once(EXEC_PLAN, "Updated: 2026-08-08", "Updated: 2026-08-09")
replace_once(
    EXEC_PLAN,
    '''- Murph generates a low-quality square JPEG with `output_compression: 40` to reduce payload size against the existing vCard-photo envelope, durably captures it, publishes it through the existing short-lived private-image path, requires that photo to load, embeds it in the first-party vCard, and sends the vCard through the existing Linq attachment path.
''',
    '''- Murph generates a compact square JPEG at the fixed medium image quality with `output_compression: 40`, durably captures it, publishes it through the existing short-lived private-image path, requires that photo to load, embeds it in the first-party vCard, and sends the vCard through the existing Linq attachment path.
''',
)
replace_once(
    EXEC_PLAN,
    '''- Personalized sends reuse the existing durable contact-card reservation table under a separate blinded per-chat variant key, so automatic or canonical cards cannot suppress an explicit personalized request.
''',
    '''- Personalized sends write no reservation row. They use the trusted accepted-request identity as the provider idempotency key, so a replay of one request collapses while a distinct request sends immediately; canonical shares alone retain the existing durable reservation.
''',
)
replace_once(
    EXEC_PLAN,
    '''- The assistant can claim the card was sent only after the Web/Linq result reports `sent`.
''',
    '''- The assistant can claim completion only after Web/Linq reports `sent`, or `already_shared` when Linq's exact same-key conflict proves that this accepted request was already delivered.
''',
)
replace_once(
    EXEC_PLAN,
    '''- Focused Web suites covering authorization, private URL validation, required-photo composition, per-variant durable throttling, timeout composition, and Linq attachment delivery.
''',
    '''- Focused Web suites covering exact canonical/personalized request shapes, authorization-path isolation, private URL validation, required-photo composition, stable per-request idempotency, timeout composition, and Linq attachment delivery.
''',
)
