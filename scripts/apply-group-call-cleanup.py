from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] if Path(__file__).parent.name == "scripts" else Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_exact(path: str, old: str, new: str, *, expected: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} exact matches, found {count}")
    write(path, text.replace(old, new, expected))


def replace_all(path: str, old: str, new: str, *, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} matches, found {count}")
    write(path, text.replace(old, new))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    write(path, text[:start_index] + replacement + text[end_index:])


def mutate_between(path: str, start: str, end: str, transform) -> None:
    text = read(path)
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    block = text[start_index:end_index]
    updated = transform(block)
    if updated == block:
        raise RuntimeError(f"{path}: transform made no changes between {start!r} and {end!r}")
    write(path, text[:start_index] + updated + text[end_index:])


def regex_replace(path: str, pattern: str, replacement: str, *, expected: int = 1) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, flags=re.DOTALL)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} regex matches, found {count}: {pattern!r}")
    write(path, updated)


DYNAMIC_TOOLS = "packages/assistant-engine/src/assistant-codex/dynamic-tools.ts"
old_dynamic_group_gate = """        const groupRequester = conversationScope === 'group'
          ? await authorizeDynamicToolParticipant({
              authorizer: input.authorizeAcceptedMessageTarget ?? null,
              deliveryContextOrdinal: input.deliveryContextOrdinal ?? null,
              messageRef: input.request.messageRef ?? '',
            })
          : null
        if (conversationScope === 'group') {
          const confirmationInputId = input.request.messageRef
          if (!groupRequester) {
            return toolTextResult(
              false,
              'group phone calling requires the exact accepted Message ref from the participant who confirmed the call preview',
            )
          }
          const previewAuthority = confirmationInputId
            ? await hostedToolContext
              .currentGroupPhoneCallPreviewAuthority?.({
                brief,
                confirmationInputId,
              })
            : null
          if (!previewAuthority) {
            return toolTextResult(
              false,
              'group phone calling requires an exact preview that was successfully delivered before the referenced current confirmation; deliver or repeat the complete preview, stop, and ask the room to confirm it in a later message',
            )
          }
        }
"""
new_dynamic_group_gate = """        const groupMessageRef = conversationScope === 'group'
          ? input.request.messageRef
          : null
        if (
          conversationScope === 'group'
          && (
            !groupMessageRef
            || groupMessageRef !== userActionScope?.acceptedInputIds.at(-1)
          )
        ) {
          return toolTextResult(
            false,
            'group phone calling requires the exact current accepted Message ref from the requesting participant',
          )
        }
        const groupRequester = conversationScope === 'group' && groupMessageRef
          ? await authorizeDynamicToolParticipant({
              authorizer: input.authorizeAcceptedMessageTarget ?? null,
              deliveryContextOrdinal: input.deliveryContextOrdinal ?? null,
              messageRef: groupMessageRef,
            })
          : null
        if (conversationScope === 'group' && !groupRequester) {
          return toolTextResult(
            false,
            'group phone calling requires the exact current accepted Message ref from the requesting participant',
          )
        }
"""
replace_exact(DYNAMIC_TOOLS, old_dynamic_group_gate, new_dynamic_group_gate)

CAPABILITY_TEST = "packages/assistant-engine/test/assistant-capability-policy-skills.test.ts"
capability_block = """  it('keeps group logistics, consent, disclosure, transfer, and result semantics together', async () => {
    const skill = await readSkill('phone-calls')
    const normalized = normalizeWhitespace(skill)
    const registration = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'phone-calls',
    )

    expect(registration?.triggerHint).toContain(
      'hosted group Murph may call a public venue or service business',
    )
    expect(registration?.triggerHint).toContain(
      'ordinary shared-life logistics task',
    )
    expect(normalized).toContain(
      'Private and hosted-group calls use the same consent and readiness flow.',
    )
    expect(normalized).toContain(
      'Never emit a special structured preview, or require a second turn, merely because the request came from a group.',
    )
    expect(normalized).toContain(
      'the current bounded request may authorize the call in the same provider turn',
    )
    expect(normalized).toContain(
      'Set `message_ref` to that request\'s visible `ain_...` reference.',
    )
    expect(normalized).toContain(
      'It must still be the newest accepted request when the call starts.',
    )
    expect(normalized).toContain(
      'The host reloads that exact message and revalidates the provider sender\'s current room membership and Murph activation.',
    )
    expect(normalized).toContain(
      'The current requester must explicitly supply or approve any requester name or contact fact used in the call.',
    )
    expect(normalized).toContain(
      'One participant\'s request never authorizes a different participant\'s identity, account, contact details, health facts, or other private facts.',
    )
    expect(normalized).toContain(
      'For a hosted-group reservation, availability check, or service call',
    )
    expect(normalized).toContain(
      'do not load `appointment-scheduling` unless health care is involved',
    )
    expect(normalized).toContain('party size or resource count')
    expect(normalized).toContain(
      'charge, commitment, materially different booking, or failed reservation',
    )
    expect(normalized).toContain(
      'Do not make a purchase, payment, reservation, or other commitment unless the requester explicitly asked for it and supplied adequate bounds.',
    )
    expect(normalized).toContain(
      'This skill never expands the conversation\'s scope boundary or authorizes code production or work, school, or professional operations.',
    )
    expect(normalized).toContain('room-visible logistical facts may be used')
    expect(normalized).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md',
    )
    expect(normalized).toContain('satisfy its ready-to-act gate')
    expect(normalized).toContain('Set `callerName`')
    expect(normalized).toContain('call-relevant, disclosable facts approved by the requester')
    expect(normalized).toContain(
      'A requester name or contact fact may be disclosed only when the destination requires it and the current request explicitly supplies or approves it',
    )
    expect(normalized).toContain(
      'never infer or disclose another participant\'s private identity, account, contact, or health facts',
    )
    expect(normalized).toContain('Never include unrelated health details')
    expect(normalized).toContain('Set `allowTransferToUser: true`')
    expect(normalized).toContain('Set it to `false` for information-only calls')
    expect(normalized).toContain('Never call emergency services')
    expect(normalized).not.toContain(['GROUP', 'CALL', 'PREVIEW'].join(' '))
    expect(normalized).not.toContain('Render exactly these ten lines')

    for (const status of ['starting', 'calling', 'failed'] as const) {
      expect(skill).toContain(`\`${status}\``)
      expect(hostedPhoneCallStartResponseSchema.safeParse({
        phoneCallId: 'phone-call-test',
        status,
      }).success).toBe(true)
    }
    expect(normalized).toContain(
      'Await the later call result before claiming connection, an answer, a booking, an agreement, or any other outcome.',
    )
  })

"""
replace_between(
    CAPABILITY_TEST,
    "  it('keeps group logistics, consent, disclosure, transfer, and result semantics together', async () => {",
    "  it('keeps Family product routing separate from family health context', async () => {",
    capability_block,
)

PHONE_TEST = "packages/assistant-engine/test/assistant-phone-calls.test.ts"
replace_all(PHONE_TEST, "GROUP_CONFIRMATION_REF", "GROUP_REQUEST_REF")
replace_exact(
    PHONE_TEST,
    """    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Before preparing a preview for a real call or placing one",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "only when the current requester explicitly confirms an exact GROUP CALL PREVIEW that Murph successfully delivered before that confirmation message was received",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Never deliver a group preview and start the call in the same provider turn",
    );
""",
    """    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Use the same explicit-consent or ready-to-act flow in private and hosted group conversations",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "does not require a special structured preview or a later confirmation solely because it is a group",
    );
""",
)
replace_exact(
    PHONE_TEST,
    """    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "never supply a canonical member id",
    );
""",
    """    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "never supply a canonical member id",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).not.toContain(
      ["GROUP", "CALL", "PREVIEW"].join(" "),
    );
""",
)
positive_group_test = """  it("uses the exact current group request for requester authority", async () => {
    const effectiveBrief = {
      ...BASE_BRIEF,
      allowTransferToUser: false,
    };
    const phoneCallScope = {
      ...BASE_SCOPE,
      acceptedInputIds: [
        OTHER_GROUP_INPUT_ID,
        GROUP_REQUEST_REF,
      ],
      inboundMailboxItemIds: [
        "earlier_group_mailbox_item",
        "group-request-mailbox-item",
      ],
      conversationScope: "group" as const,
      originSessionId: "session_group_phone_call",
    };
    const expectedRequestKey = createPhoneCallRequestKey({
      brief: effectiveBrief,
      scope: phoneCallScope,
    });
    const groupRequester = {
      assistantInputId: GROUP_REQUEST_REF,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const authorizeAcceptedMessageTarget = vi.fn(async () => ({
      participant: groupRequester,
      targetInputId: GROUP_REQUEST_REF,
    }));
    const start = vi.fn(async () => ({
      phoneCallId: "hpc_group",
      status: "calling" as const,
    }));
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        ...BASE_BRIEF,
        message_ref: GROUP_REQUEST_REF,
      },
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => phoneCallScope,
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledTimes(1);
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: "participant-effect",
      deliveryContextOrdinal: 0,
      messageRef: GROUP_REQUEST_REF,
    });
    expect(start).toHaveBeenCalledWith({
      brief: effectiveBrief,
      groupRequester,
      originSessionId: "session_group_phone_call",
      requestKey: expectedRequestKey,
    }, {
      signal: null,
    });
    expect(result.rpcResult.success).toBe(true);
  });

"""
replace_between(
    PHONE_TEST,
    '  it("uses the exact accepted group message for requester authority", async () => {',
    '  it("rechecks delivered-preview authority before starting a group call", async () => {',
    positive_group_test,
)
stale_group_test = """  it("rejects a stale group message ref before participant authorization", async () => {
    const start = vi.fn();
    const authorizeAcceptedMessageTarget = vi.fn();
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        ...BASE_BRIEF,
        message_ref: OTHER_GROUP_INPUT_ID,
      },
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: [OTHER_GROUP_INPUT_ID, GROUP_REQUEST_REF],
          conversationScope: "group",
          originSessionId: "session_group_phone_call",
        }),
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(authorizeAcceptedMessageTarget).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "exact current accepted Message ref from the requesting participant",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("preview");
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("later message");
  });

"""
replace_between(
    PHONE_TEST,
    '  it("rechecks delivered-preview authority before starting a group call", async () => {',
    '  it.each([',
    stale_group_test,
)
negative_group_test = """  it.each([
    ["missing message_ref", BASE_BRIEF, async (): ReturnType<
      AssistantAcceptedMessageTargetAuthorizer
    > => ({
      participant: {
        assistantInputId: GROUP_REQUEST_REF,
        senderHandle: "+15551110003",
        source: "linq" as const,
      },
      targetInputId: GROUP_REQUEST_REF,
    })],
    ["invented message_ref", { ...BASE_BRIEF, message_ref: GROUP_REQUEST_REF }, async (): ReturnType<
      AssistantAcceptedMessageTargetAuthorizer
    > => null],
    [
      "cross-message requester",
      { ...BASE_BRIEF, message_ref: GROUP_REQUEST_REF },
      async (): ReturnType<AssistantAcceptedMessageTargetAuthorizer> => ({
        participant: {
          assistantInputId: OTHER_GROUP_INPUT_ID,
          senderHandle: "+15551110002",
          source: "linq" as const,
        },
        targetInputId: GROUP_REQUEST_REF,
      }),
    ],
  ] as const)("fails closed for group phone calls with %s", async (
    _case,
    argumentsValue,
    authorizeAcceptedMessageTarget,
  ) => {
    const start = vi.fn();
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue,
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: [OTHER_GROUP_INPUT_ID, GROUP_REQUEST_REF],
          conversationScope: "group",
          originSessionId: "session_group_phone_call",
        }),
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "exact current accepted Message ref from the requesting participant",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("preview");
    expect(start).not.toHaveBeenCalled();
  });

"""
replace_between(
    PHONE_TEST,
    '  it.each([\n    ["missing message_ref", BASE_BRIEF, async (): ReturnType<',
    '  it("keeps group requester authorization failures neutral", async () => {',
    negative_group_test,
)
replace_exact(
    PHONE_TEST,
    """        currentGroupPhoneCallPreviewAuthority: vi.fn(async () => ({
          assistantInputId: GROUP_REQUEST_REF,
        })),
""",
    "",
)
replace_exact(
    PHONE_TEST,
    """  currentGroupPhoneCallPreviewAuthority?: AssistantHostedToolContext["currentGroupPhoneCallPreviewAuthority"];
""",
    "",
)
replace_exact(
    PHONE_TEST,
    """    currentGroupPhoneCallPreviewAuthority:
      input.currentGroupPhoneCallPreviewAuthority,
""",
    "",
)

PLANNING_TEST = "packages/assistant-engine/test/assistant-codex-turn-planning.test.ts"

def update_group_scope_block(block: str) -> str:
    preview_property = """      currentGroupPhoneCallPreviewAuthority: vi.fn(async () => ({
        assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      })),
"""
    if block.count(preview_property) != 1:
        raise RuntimeError("group scope block: preview property count mismatch")
    block = block.replace(preview_property, "", 1)
    needle = """      hostedToolContext,
      input: {
"""
    if block.count(needle) != 1:
        raise RuntimeError("group scope block: hostedToolContext insertion mismatch")
    return block.replace(
        needle,
        """      hostedToolContext,
      messageTargetAuthorizerAvailable: true,
      input: {
""",
        1,
    )

mutate_between(
    PLANNING_TEST,
    "  it('derives a group-scoped prompt and tool surface from the audience', async () => {",
    "  it('applies hosted room tone and voice to group notification planning only', async () => {",
    update_group_scope_block,
)


def update_telegram_group_block(block: str) -> str:
    preview_property = """        currentGroupPhoneCallPreviewAuthority: vi.fn(async () => ({
          assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
        })),
"""
    if block.count(preview_property) != 1:
        raise RuntimeError("telegram group block: preview property count mismatch")
    block = block.replace(preview_property, "", 1)
    needle = """      hostedToolContext: {
        ...createHostedToolContext(),
        phoneCalls: { start: vi.fn() },
      },
      input: {
"""
    if block.count(needle) != 1:
        raise RuntimeError("telegram group block: authorizer insertion mismatch")
    return block.replace(
        needle,
        """      hostedToolContext: {
        ...createHostedToolContext(),
        phoneCalls: { start: vi.fn() },
      },
      messageTargetAuthorizerAvailable: true,
      input: {
""",
        1,
    )

mutate_between(
    PLANNING_TEST,
    "  it('keeps phone calls available on authenticated Telegram group turns', async () => {",
    "  it.each([\n    ['direct Linq', 'linq', true, true],",
    update_telegram_group_block,
)
planner_negative = """  it('withholds group phone calls without participant targeting authority', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue(
      null,
    )
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const plan = await resolveAssistantRouteTurnPlan({
      acceptedInputItems: [{
        id: 'linq-group-phone-request',
        source: 'manual',
      }],
      executionContext: {
        hosted: {
          memberId: 'member-group-container',
          progressDeliveryDependencies: {},
          providerFetch: null,
          userEnvKeys: [],
        },
      },
      hostedToolContext: {
        ...createHostedToolContext(),
        phoneCalls: { start: vi.fn() },
      },
      input: {
        ...createMessageInput(),
        channel: 'linq',
        threadIsDirect: false,
      },
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-28',
        currentTimeZone: 'America/New_York',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan({}, {
        channel: 'linq',
        effectiveThreadIsDirect: false,
        threadId: 'linq-group-thread',
        threadIsDirect: false,
      }),
    })

    expect(plan.dynamicTools.map((tool) => tool.name)).not.toContain(
      'create_phone_call',
    )
  })

"""
replace_between(
    PLANNING_TEST,
    "  it('withholds group phone calls until a delivered preview precedes the current input', async () => {",
    "  it('fails closed on personal prompt context and tools for an unverified external audience', async () => {",
    planner_negative,
)

SCRIPTED_TEST = "packages/assistant-engine/test/assistant-codex-scripted-runtime.test.ts"
replace_exact(SCRIPTED_TEST, "    const previewAuthorityChecks: unknown[] = []\n", "")
regex_replace(
    SCRIPTED_TEST,
    r"      currentGroupPhoneCallPreviewAuthority: async \(input\) => \{\n        previewAuthorityChecks\.push\(input\)\n        return input\?\.confirmationInputId === messageRef\n          \? \{ assistantInputId: messageRef \}\n          : null\n      \},\n",
    "",
)
regex_replace(
    SCRIPTED_TEST,
    r"    expect\(previewAuthorityChecks\)\.toEqual\(\[\{.*?\n    expect\(phoneCallStarts\)\.toEqual\(",
    "    expect(phoneCallStarts).toEqual(",
)

REAL_E2E_TEST = "packages/assistant-engine/test/assistant-codex-real-e2e.test.ts"
real_e2e_block = """  it(
    'places one bounded group call from the current request without a group-only preview turn',
    async () => {
      const config = await resolveRealCodexE2eConfig()
      const messageRef = `ain_${'1'.repeat(32)}`
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-group-phone-call-e2e-'),
      )

      try {
        const skillsRoot = path.join(workingDirectory, 'skills')
        await Promise.all(
          (['group-chat', 'phone-calls'] as const).map(async (slug) => {
            await materializeAssistantSkill({
              skillsRoot,
              slug,
            })
          }),
        )
        const result = await executeRealCodexAppServerTurn({
          approvalPolicy: 'never',
          baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
          codexCommand:
            normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
            ?? undefined,
          codexHome: config.codexHome,
          developerInstructions:
            buildGroupPointOfViewDeveloperInstructions(),
          dynamicTools: [MURPH_CREATE_PHONE_CALL_TOOL],
          env: {
            ...config.env,
            [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
          },
          excludeResumeTurns: true,
          model: config.model,
          modelProvider: config.modelProvider,
          prompt: [
            `Message ref: ${messageRef}`,
            'Sender: participant-a',
            'Profile name (display only): "Sam"',
            'Place exactly one public restaurant call now for this room.',
            'Reserve an outdoor table for six on August 15, 2026 at 7:00 p.m. America/New_York time by calling +12025550123.',
            'A deposit is acceptable only up to $50 and only if refundable until 24 hours before the reservation.',
            'I explicitly approve using my caller name Sam and sharing only that name and those room-visible reservation details.',
            'Do not transfer the call to a participant. This is the complete bounded request; do not require a group-only preview or a later confirmation.',
          ].join('\n\n'),
          reasoningEffort: 'low',
          sandbox: 'workspace-write',
          workingDirectory,
        })
        const actions = readCapabilityRoutingActions(result.jsonEvents)
        const skillRead = actions.find((action) =>
          action.kind === 'command'
          && action.command.includes('phone-calls/SKILL.md')
          && action.output.includes('# Phone Calls')
        )
        const toolCalls = actions.filter((action) =>
          action.kind === 'dynamic'
          && action.tool === MURPH_CREATE_PHONE_CALL_TOOL.name
        )

        expect(skillRead, 'phone-calls skill read').toBeDefined()
        expect(toolCalls).toHaveLength(1)
        const toolCall = toolCalls[0]
        if (toolCall?.kind !== 'dynamic') {
          throw new Error('Expected a real group phone-call tool call.')
        }
        expect(
          skillRead !== undefined && toolCall.eventIndex > skillRead.eventIndex,
          'phone-calls skill read before the real call',
        ).toBe(true)
        expect(toolCall.argumentsValue.message_ref).toBe(messageRef)
        expect(toolCall.argumentsValue).toMatchObject({
          allowTransferToUser: false,
          callerName: 'Sam',
          goal: expect.stringMatching(/reserve|reservation/iu),
          timeZone: 'America/New_York',
          to: {
            phoneNumber: '+12025550123',
          },
        })
        const serializedArguments = JSON.stringify(toolCall.argumentsValue)
        expect(serializedArguments).toMatch(/August 15|2026-08-15/iu)
        expect(serializedArguments).toMatch(/six|party.?size.{0,20}6/iu)
        expect(serializedArguments).toMatch(/\$?50|deposit/iu)
        expect(serializedArguments).toMatch(/24 hours|24-hour|refund/iu)
        const removedStructuredHeading = ['GROUP', 'CALL', 'PREVIEW'].join(' ')
        expect(serializedArguments).not.toContain(removedStructuredHeading)
        expect(result.finalMessage).not.toContain(removedStructuredHeading)
      } finally {
        await removeRealCodexTemporaryPaths([
          workingDirectory,
          ...config.temporaryPaths,
        ])
      }
    },
    360_000,
  )
"""
replace_between(
    REAL_E2E_TEST,
    "  it(\n    'delivers a group call preview in one turn and calls only after a later exact confirmation',",
    "})\n\ndescribeRealCodex('real Codex official weather-alert context e2e'",
    real_e2e_block,
)

preview_test = ROOT / "packages/assistant-engine/test/assistant-group-phone-call-preview-authority.test.ts"
if not preview_test.exists():
    raise RuntimeError(f"missing legacy preview test: {preview_test}")
preview_test.unlink()

for path in [
    DYNAMIC_TOOLS,
    PHONE_TEST,
    PLANNING_TEST,
    SCRIPTED_TEST,
    REAL_E2E_TEST,
]:
    text = read(path)
    for forbidden in [
        "currentGroupPhoneCallPreviewAuthority",
        "resolveDeliveredAssistantGroupPhoneCallPreviewAuthority",
        "AssistantGroupPhoneCallPreviewAuthority",
        "previewAuthorityChecks",
    ]:
        if forbidden in text:
            raise RuntimeError(f"{path}: legacy preview symbol remains: {forbidden}")

print("group phone-call cleanup applied")
