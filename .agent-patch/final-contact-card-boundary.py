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
            f"{path}: expected exactly one replacement target, found {count}: {old[:160]!r}"
        )
    write(path, text.replace(old, new, 1))


def replace_block(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{path}: missing block start {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{path}: missing block end {end_marker!r}")
    write(path, text[:start] + replacement + text[end:])


# The pre-bind assistant request may omit only the direct chat id. Image and
# accepted-request identity are a pair, and a personalized request can never
# carry group-thread authority.
replace_once(
    "packages/hosted-execution/src/runtime-control.ts",
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
    "packages/hosted-execution/src/parsers/runtime-control.ts",
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

# Preserve the conservative declaration for the canonical action. The direct
# personalized variant owns its narrower authorization explicitly in its own
# handler branch rather than weakening the shared action classification.
replace_once(
    "apps/web/src/lib/hosted-groups/group-tool.ts",
    '  share_contact_card: "participant_aware",\n',
    '  share_contact_card: "owner_active",\n',
)

replace_once(
    "apps/web/src/lib/hosted-groups/group-tool.ts",
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

replace_block(
    "apps/web/src/lib/hosted-groups/group-tool.ts",
    'async function handleHostedRuntimeGroupShareContactCard(input: {\n',
    "\n}",
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
}''',
)

# Personalized composition is one exact pair: generated image URL + stable
# accepted-request send key. Canonical shares alone retain wall-clock
# reservation ownership.
replace_block(
    "apps/web/src/lib/hosted-onboarding/linq-contact-card-share.ts",
    '/**\n * Share Murph\'s first-party vCard into a Linq chat as an attachment.',
    "",
    "",
)
