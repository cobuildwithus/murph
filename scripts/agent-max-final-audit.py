#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all_exact(path: str, old: str, new: str, expected: int) -> None:
    content = read(path)
    count = content.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


def insert_before(path: str, marker: str, addition: str) -> None:
    replace_once(path, marker, addition + marker)


def replace_between(path: str, start_marker: str, end_marker: str, transform) -> None:
    content = read(path)
    start = content.index(start_marker)
    end = content.index(end_marker, start)
    block = content[start:end]
    updated = transform(block)
    if updated == block:
        raise RuntimeError(f"{path}: transform made no change between markers")
    write(path, content[:start] + updated + content[end:])


# Keep plan selling points in the central catalog introduced on main.
replace_once(
    "apps/web/src/lib/hosted-onboarding/plan-features.ts",
    "// Copy rule: only Edge may claim the most capable AI models. The top model\n"
    "// requires an active paid Edge plan (ASSISTANT_MODEL_SOL_REQUIRES_EDGE), so\n"
    "// that claim on Pulse or Core would promise something the product blocks.\n",
    "// Copy rule: only Edge and Max may claim the most capable AI models. The\n"
    "// top model requires an active paid Edge-or-higher direct plan\n"
    "// (ASSISTANT_MODEL_SOL_REQUIRES_EDGE), so that claim on Pulse or Core would\n"
    "// promise something the product blocks.\n",
)
insert_before(
    "apps/web/src/lib/hosted-onboarding/plan-features.ts",
    "export const JOIN_EDGE_FEATURES = [\n",
    "export const SETTINGS_MAX_FEATURES = [\n"
    "  \"Everything in Edge\",\n"
    "  \"Highest included monthly AI usage\",\n"
    "  \"More room for long records and deep research\",\n"
    "  \"Built for the most demanding Murph workflows\",\n"
    "] as const;\n\n",
)

# Resolve the Settings conflict by retaining main's shared feature catalog and
# reapplying Max as one more generic direct-plan card.
settings = "apps/web/src/components/settings/hosted-billing-settings.tsx"
replace_once(
    settings,
    "  SETTINGS_FAMILY_FEATURES,\n  SETTINGS_PULSE_FEATURES,\n",
    "  SETTINGS_FAMILY_FEATURES,\n  SETTINGS_MAX_FEATURES,\n  SETTINGS_PULSE_FEATURES,\n",
)
replace_once(
    settings,
    "  canStartPaidPulse?: boolean;\n  canSwitchToGroup?: boolean;\n",
    "  canStartPaidPulse?: boolean;\n  canSwitchToEdge?: boolean;\n  canSwitchToGroup?: boolean;\n",
)
replace_once(
    settings,
    "  canUpgradeToPulse?: boolean;\n  canUpgradeToEdge?: boolean;\n",
    "  canUpgradeToPulse?: boolean;\n  canUpgradeToEdge?: boolean;\n  canUpgradeToMax?: boolean;\n",
)
replace_once(
    settings,
    "  showGroupPlan?: boolean;\n  pulseTrialBillingContinuationPending?: boolean;\n",
    "  showGroupPlan?: boolean;\n  showMaxPlan?: boolean;\n  pulseTrialBillingContinuationPending?: boolean;\n",
)
replace_once(
    settings,
    "  const edgeCurrent =\n    ownPaidBillingActive && currentPlanCode === \"launch_edge_monthly\";\n",
    "  const edgeCurrent =\n    ownPaidBillingActive && currentPlanCode === \"launch_edge_monthly\";\n"
    "  const maxCurrent =\n"
    "    ownPaidBillingActive && currentPlanCode === \"launch_max_monthly\";\n",
)
replace_once(
    settings,
    "  const hasPendingPulseSwitch =\n"
    "    scheduledPlanCode === \"launch_monthly\" && scheduledBillingEffectiveAt !== null;\n"
    "  const pendingGroupSwitchDate = hasPendingGroupSwitch\n",
    "  const hasPendingPulseSwitch =\n"
    "    scheduledPlanCode === \"launch_monthly\" && scheduledBillingEffectiveAt !== null;\n"
    "  const hasPendingEdgeSwitch =\n"
    "    scheduledPlanCode === \"launch_edge_monthly\" &&\n"
    "    scheduledBillingEffectiveAt !== null;\n"
    "  const pendingGroupSwitchDate = hasPendingGroupSwitch\n",
)
replace_once(
    settings,
    "  const pendingPulseSwitchDate = hasPendingPulseSwitch\n"
    "    ? formatHostedBillingDate(scheduledBillingEffectiveAt)\n"
    "    : null;\n\n"
    "  const cards: PlanCardModel[] = [\n"
    "    ...(props.showGroupPlan === true && !familyCurrent\n",
    "  const pendingPulseSwitchDate = hasPendingPulseSwitch\n"
    "    ? formatHostedBillingDate(scheduledBillingEffectiveAt)\n"
    "    : null;\n"
    "  const pendingEdgeSwitchDate = hasPendingEdgeSwitch\n"
    "    ? formatHostedBillingDate(scheduledBillingEffectiveAt)\n"
    "    : null;\n"
    "  const showGroupPlanCard = props.showGroupPlan === true && !familyCurrent;\n"
    "  const showMaxPlanCard = props.showMaxPlan === true;\n\n"
    "  const cards: PlanCardModel[] = [\n"
    "    ...(showGroupPlanCard\n",
)
replace_once(
    settings,
    "        : edgeCurrent\n"
    "        ? <CurrentPlanButton />\n"
    "        : props.canUpgradeToEdge === true\n",
    "        : edgeCurrent\n"
    "        ? <CurrentPlanButton />\n"
    "        : hasPendingEdgeSwitch\n"
    "          ? null\n"
    "        : maxCurrent && props.canSwitchToEdge === true\n"
    "          ? (\n"
    "              <HostedPlanChangeButton\n"
    "                block\n"
    "                currentPeriodEnd={currentPeriodEndIso}\n"
    "                mode=\"schedule\"\n"
    "                targetPlanCode=\"launch_edge_monthly\"\n"
    "              >\n"
    "                Choose Edge\n"
    "              </HostedPlanChangeButton>\n"
    "            )\n"
    "        : props.canUpgradeToEdge === true\n",
)
replace_once(
    settings,
    "        : edgeCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate\n"
    "        ? (\n"
    "            <PendingPlanChangeNote\n"
    "              currentPlanName=\"Edge\"\n"
    "              effectiveAt={pendingGroupSwitchDate}\n"
    "              targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}\n"
    "            />\n"
    "          )\n"
    "        : null,\n",
    "        : edgeCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate\n"
    "        ? (\n"
    "            <PendingPlanChangeNote\n"
    "              currentPlanName=\"Edge\"\n"
    "              effectiveAt={pendingGroupSwitchDate}\n"
    "              targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}\n"
    "            />\n"
    "          )\n"
    "        : !edgeCurrent && hasPendingEdgeSwitch && pendingEdgeSwitchDate\n"
    "          ? `Scheduled to start ${pendingEdgeSwitchDate}`\n"
    "          : null,\n",
)
insert_before(
    settings,
    "    {\n      action: sponsoredMember\n",
    "    ...(showMaxPlanCard\n"
    "      ? [\n"
    "          {\n"
    "            action: familyOwner\n"
    "              ? <FamilyBillingChangeButton block targetPlanName=\"Max\" />\n"
    "              : sponsoredMember\n"
    "                ? null\n"
    "                : maxCurrent\n"
    "                  ? <CurrentPlanButton />\n"
    "                  : props.canUpgradeToMax === true\n"
    "                    && (\n"
    "                      currentPlanCode === \"launch_group_monthly\"\n"
    "                      || currentPlanCode === \"launch_monthly\"\n"
    "                      || currentPlanCode === \"launch_edge_monthly\"\n"
    "                    )\n"
    "                    ? (\n"
    "                        <HostedPlanChangeButton\n"
    "                          block\n"
    "                          expectedCurrentPlanCode={currentPlanCode}\n"
    "                          mode=\"upgrade\"\n"
    "                          targetPlanCode=\"launch_max_monthly\"\n"
    "                        >\n"
    "                          Choose Max\n"
    "                        </HostedPlanChangeButton>\n"
    "                      )\n"
    "                    : null,\n"
    "            current: maxCurrent,\n"
    "            currentLabel: \"Current plan\",\n"
    "            features: SETTINGS_MAX_FEATURES,\n"
    "            key: \"launch_max_monthly\",\n"
    "            name: \"Max\",\n"
    "            note: familyOwner\n"
    "              ? \"End or change the Family plan first, then switch to an individual plan.\"\n"
    "              : maxCurrent && hasPendingEdgeSwitch && pendingEdgeSwitchDate\n"
    "                ? (\n"
    "                    <PendingPlanChangeNote\n"
    "                      currentPlanName=\"Max\"\n"
    "                      effectiveAt={pendingEdgeSwitchDate}\n"
    "                      targetPlanName=\"Edge\"\n"
    "                    />\n"
    "                  )\n"
    "                : maxCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate\n"
    "                  ? (\n"
    "                      <PendingPlanChangeNote\n"
    "                        currentPlanName=\"Max\"\n"
    "                        effectiveAt={pendingPulseSwitchDate}\n"
    "                        targetPlanName=\"Pulse\"\n"
    "                      />\n"
    "                    )\n"
    "                  : maxCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate\n"
    "                    ? (\n"
    "                        <PendingPlanChangeNote\n"
    "                          currentPlanName=\"Max\"\n"
    "                          effectiveAt={pendingGroupSwitchDate}\n"
    "                          targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}\n"
    "                        />\n"
    "                      )\n"
    "                    : \"For the most demanding Murph workflows and highest included usage.\",\n"
    "            price: formatHostedBillingPrice(\n"
    "              getHostedBillingPlanDefinition(\"launch_max_monthly\")\n"
    "                .recurringAmountUsdCents,\n"
    "            ),\n"
    "          } satisfies PlanCardModel,\n"
    "        ]\n"
    "      : []),\n",
)
replace_once(
    settings,
    "  const planResolved = groupCurrent || pulseCurrent || edgeCurrent || familyCurrent;\n",
    "  const planResolved =\n"
    "    groupCurrent || pulseCurrent || edgeCurrent || maxCurrent || familyCurrent;\n",
)
replace_once(
    settings,
    "          props.showGroupPlan === true && !familyCurrent\n"
    "            ? \"sm:grid-cols-2 lg:grid-cols-4\"\n"
    "            : \"sm:grid-cols-3\",\n",
    "          showGroupPlanCard && showMaxPlanCard\n"
    "            ? \"sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5\"\n"
    "            : showGroupPlanCard || showMaxPlanCard\n"
    "              ? \"sm:grid-cols-2 xl:grid-cols-4\"\n"
    "              : \"sm:grid-cols-3\",\n",
)
replace_once(
    settings,
    '  targetPlanName: "Edge" | "Pulse";\n',
    '  targetPlanName: "Edge" | "Max" | "Pulse";\n',
)

replace_once(
    "apps/web/app/design/sections-content.tsx",
    '<StudySection title="Subscription recovery, sponsored billing, and usage limits">',
    '<StudySection title="Subscription recovery, Max upgrades, sponsored billing, and usage limits">',
)

# A Max member must never receive a Pulse-to-Edge exhaustion notice. Retain the
# deployed premium notice code but make its copy tier-neutral.
def patch_usage_notice(block: str) -> str:
    old = '  if (input.billingPlanCode === "launch_edge_monthly") {'
    if block.count(old) != 1:
        raise RuntimeError(f"usage notice block expected one Edge check, found {block.count(old)}")
    return block.replace(
        old,
        "  // Preserve the deployed premium notice code for direct paid plans at\n"
        "  // or above Edge; delivery consumers do not need a new wire value for\n"
        "  // every higher-capacity billing tier.\n"
        "  if (\n"
        "    input.billingPlanCode === \"launch_edge_monthly\"\n"
        "    || input.billingPlanCode === \"launch_max_monthly\"\n"
        "  ) {",
        1,
    )


replace_between(
    "apps/web/src/lib/hosted-execution/usage-allowance.ts",
    "function buildHostedAiUsageGateLimitNotice(",
    "\nfunction buildHostedTrialExpiredPendingBillingNotice(",
    patch_usage_notice,
)


def neutralize_premium_templates(block: str) -> str:
    block = block.replace("Edge's included usage", "Your included AI usage")
    block = block.replace("Edge", "AI")
    return block


replace_between(
    "apps/web/src/lib/hosted-messages/user-facing-messages.ts",
    '  "linq.ai_usage.edge_limit_reached": [',
    '  "linq.ai_usage.family_limit_reached": [',
    neutralize_premium_templates,
)

replace_once(
    "apps/web/src/components/home/usage-limit-banner.tsx",
    '    title: "You\'ve used 100% of this month\'s included Edge usage",\n',
    '    title: "You\'ve used 100% of this month\'s included monthly AI usage",\n',
)
replace_once(
    "apps/web/src/components/home/usage-limit-banner.tsx",
    '            : " Edge offers more included usage."\n',
    '            : action.targetPlanCode === "launch_max_monthly"\n'
    '              ? " Max offers the highest included monthly usage."\n'
    '              : action.targetPlanCode === "launch_edge_monthly"\n'
    '                ? " Edge offers more included usage."\n'
    '                : ""\n',
)

# The switch service already owns source/target validity. The HTTP route should
# validate only the shared canonical code rather than duplicating a stale list.
replace_once(
    "apps/web/app/api/settings/billing/switch-plan/route.ts",
    "  if (\n"
    "    targetPlanCode !== \"launch_group_monthly\"\n"
    "    && targetPlanCode !== \"launch_monthly\"\n"
    "  ) {\n",
    "  if (!targetPlanCode) {\n",
)
replace_once(
    "apps/web/app/api/settings/billing/switch-plan/route.ts",
    '      message:\n        "targetPlanCode must be launch_group_monthly or launch_monthly.",\n',
    '      message: "targetPlanCode must name a supported billing plan.",\n',
)

# Avoid another direct-plan return allowlist in the page projection.
replace_once(
    "apps/web/app/(dashboard)/settings/page.tsx",
    "  const directPlanUpdateTarget =\n"
    "    !activeFamilyOwner &&\n"
    "    !sponsoredMember &&\n"
    "    (\n"
    "      planChangeReturn === \"launch_edge_monthly\" ||\n"
    "      planChangeReturn === \"launch_max_monthly\" ||\n"
    "      planChangeReturn === \"launch_monthly\"\n"
    "    )\n"
    "      ? planChangeReturn\n"
    "      : null;\n",
    "  const directPlanUpdateTarget =\n"
    "    !activeFamilyOwner && !sponsoredMember\n"
    "      ? parseHostedBillingPlanCode(planChangeReturn)\n"
    "      : null;\n",
)

# Keep web input types derived from the shared plan-usage contract.
usage_status = "apps/web/src/lib/hosted-execution/usage-status.ts"
insert_before(
    usage_status,
    "type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;\n",
    "type HostedDirectBillingPlanCode = HostedPlanUsageAvailableStatus[\"planCode\"];\n",
)
replace_all_exact(
    usage_status,
    "    | \"launch_group_monthly\"\n"
    "    | \"launch_monthly\"\n"
    "    | \"launch_edge_monthly\"\n"
    "    | \"launch_max_monthly\";",
    "    HostedDirectBillingPlanCode;",
    3,
)
replace_once(
    usage_status,
    "  recommendedPlanCode?:\n"
    "    | \"launch_group_monthly\"\n"
    "    | \"launch_monthly\"\n"
    "    | \"launch_edge_monthly\"\n"
    "    | \"launch_max_monthly\";\n",
    "  recommendedPlanCode?: HostedDirectBillingPlanCode;\n",
)

# Document the two fail-closed Max deployment values alongside existing plans.
replace_once(
    "apps/web/.env.example",
    "# and Edge members can separately buy fixed usage-credit packs through one-time\n",
    "# and Edge or Max members can separately buy fixed usage-credit packs through one-time\n",
)
replace_once(
    "apps/web/.env.example",
    'HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY="price_replace_me"\n',
    'HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY="price_replace_me"\n'
    'HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY="price_replace_me"\n',
)
replace_once(
    "apps/web/.env.example",
    'HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY=""\n',
    'HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY=""\n'
    'HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MAX_MONTHLY=""\n',
)

# Max is available today for capacity; do not imply a future-model entitlement
# that the runtime does not implement.
skill = "packages/assistant-engine/skills/hosted-low-usage/SKILL.md"
skill_text = read(skill)
unsupported_claim = " and priority access to new frontier models as they become available"
if skill_text.count(unsupported_claim) != 1:
    raise RuntimeError(
        f"{skill}: expected one unsupported future-model claim, found {skill_text.count(unsupported_claim)}"
    )
write(skill, skill_text.replace(unsupported_claim, "", 1))

# Revenue mix must not silently classify a $50 Max member as Pulse.
growth = "apps/web/src/lib/hosted-ops/growth-metrics.ts"
replace_once(
    growth,
    "  familyMrrUsdCents: number;\n  mrrUsdCents: number;\n",
    "  familyMrrUsdCents: number;\n  maxMrrUsdCents: number;\n  maxPaidIndividuals: number;\n  mrrUsdCents: number;\n",
)
replace_once(
    growth,
    "  let edgePaidIndividuals = 0;\n  let pulseMrrUsdCents = 0;\n  let edgeMrrUsdCents = 0;\n",
    "  let edgePaidIndividuals = 0;\n  let maxPaidIndividuals = 0;\n  let pulseMrrUsdCents = 0;\n  let edgeMrrUsdCents = 0;\n  let maxMrrUsdCents = 0;\n",
)
replace_once(
    growth,
    "    if (planCode === \"launch_edge_monthly\") {\n"
    "      edgePaidIndividuals += 1;\n"
    "      edgeMrrUsdCents += amountUsdCents;\n"
    "    } else {\n",
    "    if (planCode === \"launch_max_monthly\") {\n"
    "      maxPaidIndividuals += 1;\n"
    "      maxMrrUsdCents += amountUsdCents;\n"
    "    } else if (planCode === \"launch_edge_monthly\") {\n"
    "      edgePaidIndividuals += 1;\n"
    "      edgeMrrUsdCents += amountUsdCents;\n"
    "    } else {\n",
)
replace_once(
    growth,
    "    familyMrrUsdCents,\n"
    "    mrrUsdCents: pulseMrrUsdCents + edgeMrrUsdCents + familyMrrUsdCents,\n",
    "    familyMrrUsdCents,\n"
    "    maxMrrUsdCents,\n"
    "    maxPaidIndividuals,\n"
    "    mrrUsdCents:\n"
    "      pulseMrrUsdCents + edgeMrrUsdCents + maxMrrUsdCents + familyMrrUsdCents,\n",
)
insert_before(
    "apps/web/app/(dashboard)/ops/growth/page.tsx",
    "              <TableRow>\n                <TableCell>Family seats</TableCell>\n",
    "              <TableRow>\n"
    "                <TableCell>Max individuals</TableCell>\n"
    "                <TableCell className=\"text-right\">\n"
    "                  {formatInteger(dashboard.current.maxPaidIndividuals)}\n"
    "                </TableCell>\n"
    "                <TableCell className=\"text-right\">\n"
    "                  {formatCurrency(dashboard.current.maxMrrUsdCents)}\n"
    "                </TableCell>\n"
    "              </TableRow>\n",
)

# Regression coverage.
replace_once(
    "apps/web/test/hosted-billing-settings.test.tsx",
    "    : input.targetPlanCode === \"launch_monthly\"\n"
    "      ? 800\n"
    "      : 2_000;\n",
    "    : input.targetPlanCode === \"launch_monthly\"\n"
    "      ? 800\n"
    "      : input.targetPlanCode === \"launch_max_monthly\"\n"
    "        ? 5_000\n"
    "        : 2_000;\n",
)
insert_before(
    "apps/web/test/hosted-billing-settings.test.tsx",
    "  test(\"suppresses every plan-changing action while webhook projection is pending\", async () => {\n",
    "  test(\"shows Max only from the server-authorized catalog and uses the canonical upgrade path\", async () => {\n"
    "    const { HostedBillingSettings } = await import(\n"
    "      \"@/src/components/settings/hosted-billing-settings\"\n"
    "    );\n"
    "    const hiddenMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {\n"
    "      authenticated: true,\n"
    "      billingStatus: \"active\",\n"
    "      currentBillingPhase: \"paid\",\n"
    "      currentBillingPlanCode: \"launch_edge_monthly\",\n"
    "    }));\n"
    "    const visibleMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {\n"
    "      authenticated: true,\n"
    "      billingStatus: \"active\",\n"
    "      canUpgradeToMax: true,\n"
    "      currentBillingPhase: \"paid\",\n"
    "      currentBillingPlanCode: \"launch_edge_monthly\",\n"
    "      showMaxPlan: true,\n"
    "    }));\n"
    "    const unavailableMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {\n"
    "      authenticated: true,\n"
    "      billingStatus: \"active\",\n"
    "      currentBillingPhase: \"paid\",\n"
    "      currentBillingPlanCode: \"launch_edge_monthly\",\n"
    "      showMaxPlan: true,\n"
    "    }));\n\n"
    "    assert.doesNotMatch(hiddenMarkup, />Max</);\n"
    "    assert.match(visibleMarkup, />Max</);\n"
    "    assert.match(visibleMarkup, /\\$50/);\n"
    "    assert.match(visibleMarkup, /Highest included monthly AI usage/);\n"
    "    assert.match(visibleMarkup, /Choose Max/);\n"
    "    assert.doesNotMatch(unavailableMarkup, /Choose Max/);\n"
    "  });\n\n"
    "  test(\"shows Max-to-Edge as a scheduled downgrade and keeps Max current until then\", async () => {\n"
    "    const { HostedBillingSettings } = await import(\n"
    "      \"@/src/components/settings/hosted-billing-settings\"\n"
    "    );\n"
    "    const chooserMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {\n"
    "      authenticated: true,\n"
    "      billingStatus: \"active\",\n"
    "      canSwitchToEdge: true,\n"
    "      currentBillingPhase: \"paid\",\n"
    "      currentBillingPlanCode: \"launch_max_monthly\",\n"
    "      currentPeriodEnd: new Date(\"2026-09-07T20:00:00.000Z\"),\n"
    "      showMaxPlan: true,\n"
    "    }));\n"
    "    const scheduledMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {\n"
    "      authenticated: true,\n"
    "      billingStatus: \"active\",\n"
    "      currentBillingPhase: \"paid\",\n"
    "      currentBillingPlanCode: \"launch_max_monthly\",\n"
    "      scheduledBillingEffectiveAt: new Date(\"2026-09-07T20:00:00.000Z\"),\n"
    "      scheduledBillingPlanCode: \"launch_edge_monthly\",\n"
    "      showMaxPlan: true,\n"
    "    }));\n\n"
    "    assert.match(chooserMarkup, /Choose Edge/);\n"
    "    assert.match(chooserMarkup, /Max/);\n"
    "    assert.match(scheduledMarkup, /Edge starts Sep 7, 2026/);\n"
    "    assert.match(scheduledMarkup, /Max stays active until then/);\n"
    "  });\n\n",
)

replace_once(
    "apps/web/test/settings-billing-switch-plan-route.test.ts",
    'test("rejects an unsupported scheduled target", async () => {\n'
    '  const response = await billingSwitchRoute.POST(\n'
    '    new Request("https://example.test/api/settings/billing/switch-plan", {\n'
    '      body: JSON.stringify({\n'
    '        targetPlanCode: "launch_edge_monthly",\n'
    '      }),\n'
    '      headers: {\n'
    '        origin: "https://example.test",\n'
    '      },\n'
    '      method: "POST",\n'
    '    }),\n'
    '  );\n\n'
    '  expect(response.status).toBe(400);\n'
    '  expect(mocks.scheduleHostedBillingPlanSwitch).not.toHaveBeenCalled();\n'
    '});\n',
    'test("passes Max-to-Edge scheduled downgrades to the canonical switch service", async () => {\n'
    '  mocks.scheduleHostedBillingPlanSwitch.mockResolvedValueOnce({\n'
    '    effectiveAt: "2026-09-07T20:00:00.000Z",\n'
    '    scheduledBillingPlanCode: "launch_edge_monthly",\n'
    '    status: "scheduled",\n'
    '  });\n'
    '  const response = await billingSwitchRoute.POST(\n'
    '    new Request("https://example.test/api/settings/billing/switch-plan", {\n'
    '      body: JSON.stringify({\n'
    '        targetPlanCode: "launch_edge_monthly",\n'
    '      }),\n'
    '      headers: {\n'
    '        origin: "https://example.test",\n'
    '      },\n'
    '      method: "POST",\n'
    '    }),\n'
    '  );\n\n'
    '  expect(response.status).toBe(200);\n'
    '  expect(mocks.scheduleHostedBillingPlanSwitch).toHaveBeenCalledWith({\n'
    '    memberId: "member_123",\n'
    '    prisma: { label: "test-prisma" },\n'
    '    targetPlanCode: "launch_edge_monthly",\n'
    '  });\n'
    '});\n\n'
    'test("rejects an unknown scheduled target before the switch service", async () => {\n'
    '  const response = await billingSwitchRoute.POST(\n'
    '    new Request("https://example.test/api/settings/billing/switch-plan", {\n'
    '      body: JSON.stringify({\n'
    '        targetPlanCode: "retired_plan",\n'
    '      }),\n'
    '      headers: {\n'
    '        origin: "https://example.test",\n'
    '      },\n'
    '      method: "POST",\n'
    '    }),\n'
    '  );\n\n'
    '  expect(response.status).toBe(400);\n'
    '  expect(mocks.scheduleHostedBillingPlanSwitch).not.toHaveBeenCalled();\n'
    '});\n',
)

insert_before(
    "apps/web/test/usage-limit-banner.test.tsx",
    'test("Family usage exhaustion always links to the existing add-usage flow", async () => {\n',
    'test("premium exhaustion copy stays plan-neutral while a Max action names Max", async () => {\n'
    '  const { UsageLimitBanner } = await import(\n'
    '    "@/src/components/home/usage-limit-banner"\n'
    '  );\n'
    '  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {\n'
    '    noticeCode: "edge_usage_limit_reached",\n'
    '    recommendedAction: {\n'
    '      kind: "change_plan",\n'
    '      label: "Choose Max",\n'
    '      targetPlanCode: "launch_max_monthly",\n'
    '      url: "https://example.test/settings#subscription",\n'
    '    },\n'
    '  }));\n\n'
    '  assert.match(markup, /included monthly AI usage/);\n'
    '  assert.match(markup, /Max offers the highest included monthly usage/);\n'
    '  assert.match(markup, />Choose Max</);\n'
    '  assert.doesNotMatch(markup, /Edge offers more included usage/);\n'
    '});\n\n',
)
insert_before(
    "apps/web/test/user-facing-messages.test.ts",
    '  it("keeps direct paid limit templates neutral until delivery-time projection", () => {\n',
    '  it("keeps the premium paid exhaustion template neutral across Edge and Max", () => {\n'
    '    for (const text of collectRenderedTexts("linq.ai_usage.edge_limit_reached")) {\n'
    '      expect(text).not.toMatch(/\\b(?:Edge|Max|Pulse)\\b/u);\n'
    '      expect(text).toMatch(/Murph is paused/iu);\n'
    '    }\n'
    '  });\n\n',
)

replace_once(
    "apps/web/test/hosted-ops-growth.test.ts",
    "        {\n"
    "          billingRef: {\n"
    "            currentBillingPhase: \"paid\",\n"
    "            currentBillingPlanCode: \"retired_plan\",\n"
    "          },\n"
    "          id: \"member_unknown\",\n"
    "        },\n",
    "        {\n"
    "          billingRef: {\n"
    "            currentBillingPhase: \"paid\",\n"
    "            currentBillingPlanCode: \"launch_max_monthly\",\n"
    "          },\n"
    "          id: \"member_max\",\n"
    "        },\n"
    "        {\n"
    "          billingRef: {\n"
    "            currentBillingPhase: \"paid\",\n"
    "            currentBillingPlanCode: \"retired_plan\",\n"
    "          },\n"
    "          id: \"member_unknown\",\n"
    "        },\n",
)
replace_once(
    "apps/web/test/hosted-ops-growth.test.ts",
    "      totalMembers: 4,\n",
    "      totalMembers: 5,\n",
)
replace_once(
    "apps/web/test/hosted-ops-growth.test.ts",
    "    expect(metrics.edgePaidIndividuals).toBe(1);\n"
    "    expect(metrics.payingIndividuals).toBe(3);\n",
    "    expect(metrics.edgePaidIndividuals).toBe(1);\n"
    "    expect(metrics.maxPaidIndividuals).toBe(1);\n"
    "    expect(metrics.maxMrrUsdCents).toBe(5_000);\n"
    "    expect(metrics.payingIndividuals).toBe(4);\n",
)
replace_once(
    "apps/web/test/hosted-ops-growth.test.ts",
    "    expect(metrics.coveredMembers).toBe(4);\n"
    "    expect(metrics.familyMrrUsdCents).toBe(2 * 700 + 1_900);\n"
    "    expect(metrics.mrrUsdCents).toBe(800 + 2_000 + 2 * 700 + 1_900);\n",
    "    expect(metrics.coveredMembers).toBe(5);\n"
    "    expect(metrics.familyMrrUsdCents).toBe(2 * 700 + 1_900);\n"
    "    expect(metrics.mrrUsdCents).toBe(\n"
    "      800 + 2_000 + 5_000 + 2 * 700 + 1_900,\n"
    "    );\n",
)

replace_once(
    "apps/web/test/hosted-max-plan.test.ts",
    "  getHostedBillingPlanDefinition,\n  resolveConfiguredHostedBillingPlanCodes,\n",
    "  getHostedBillingPlanDefinition,\n  isHostedBillingPlanImmediateUpgrade,\n  resolveConfiguredHostedBillingPlanCodes,\n",
)
insert_before(
    "apps/web/test/hosted-max-plan.test.ts",
    '  it("supports immediate upgrades into Max and period-end downgrades out of it", () => {\n',
    '  it("places Max above Edge in the shared direct-plan ordering", () => {\n'
    '    expect(isHostedBillingPlanImmediateUpgrade({\n'
    '      currentPlanCode: "launch_edge_monthly",\n'
    '      targetPlanCode: "launch_max_monthly",\n'
    '    })).toBe(true);\n'
    '    expect(isHostedBillingPlanImmediateUpgrade({\n'
    '      currentPlanCode: "launch_max_monthly",\n'
    '      targetPlanCode: "launch_edge_monthly",\n'
    '    })).toBe(false);\n'
    '  });\n\n',
)

# Keep the assistant test explicit that future model access is not sold.
insert_before(
    "packages/assistant-engine/test/assistant-hosted-max-plan-skill.test.ts",
    "    expect(skill).toContain(\n      'never promise a particular unreleased model or imply that future access is already active',\n    )\n",
    "    expect(skill).not.toContain('priority access to new frontier models')\n",
)

# Add the additive database compatibility update for usage resets when a paid
# member upgrades to Max and a draining writer omits the explicit transition.
migration_path = (
    ROOT
    / "apps/web/prisma/migrations/20260807233000_hosted_max_plan_transition_bridge/migration.sql"
)
migration_path.parent.mkdir(parents=True, exist_ok=True)
migration_path.write_text(
    """BEGIN;

-- Keep the rolling usage-reset bridge aligned with the canonical direct-plan
-- ordering after Max is introduced. New Web writers persist this transition
-- explicitly; this bridge protects draining or rollback writers that do not.
LOCK TABLE \"hosted_member_billing_ref\" IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION capture_hosted_member_usage_plan_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_plan_upgrade BOOLEAN;
  is_trial_conversion BOOLEAN;
  transition_was_written BOOLEAN;
BEGIN
  is_plan_upgrade := (
    OLD.current_billing_phase = 'paid'
    AND NEW.current_billing_phase = 'paid'
    AND (
      (OLD.current_billing_plan_code = 'launch_group_monthly'
        AND NEW.current_billing_plan_code IN (
          'launch_monthly',
          'launch_edge_monthly',
          'launch_max_monthly'
        ))
      OR (OLD.current_billing_plan_code = 'launch_monthly'
        AND NEW.current_billing_plan_code IN (
          'launch_edge_monthly',
          'launch_max_monthly'
        ))
      OR (OLD.current_billing_plan_code = 'launch_edge_monthly'
        AND NEW.current_billing_plan_code = 'launch_max_monthly')
    )
  ) IS TRUE;
  is_trial_conversion := (
    OLD.current_billing_phase = 'trial'
    AND NEW.current_billing_phase = 'paid'
    AND OLD.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_checkout_offer = 'pulse_trial_7d'
  ) IS TRUE;

  IF NOT (is_plan_upgrade OR is_trial_conversion) THEN
    RETURN NEW;
  END IF;

  transition_was_written :=
    NEW.usage_plan_transition_at IS DISTINCT FROM OLD.usage_plan_transition_at
    OR NEW.usage_plan_transition_from_code IS DISTINCT FROM OLD.usage_plan_transition_from_code
    OR NEW.usage_plan_transition_kind IS DISTINCT FROM OLD.usage_plan_transition_kind
    OR NEW.usage_plan_transition_to_code IS DISTINCT FROM OLD.usage_plan_transition_to_code;
  IF transition_was_written OR NEW.last_stripe_event_created_at IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.usage_plan_transition_at := NEW.last_stripe_event_created_at;
  NEW.usage_plan_transition_from_code := OLD.current_billing_plan_code;
  NEW.usage_plan_transition_kind :=
    CASE WHEN is_trial_conversion THEN 'trial_conversion' ELSE 'plan_upgrade' END;
  NEW.usage_plan_transition_to_code := NEW.current_billing_plan_code;
  RETURN NEW;
END;
$$;

COMMIT;
""",
    encoding="utf-8",
)

migration_test = ROOT / "apps/web/test/hosted-max-plan-transition-migration.test.ts"
migration_test.write_text(
    """import { readFileSync } from \"node:fs\";

import { describe, expect, it } from \"vitest\";

const migrationSql = readFileSync(
  new URL(
    \"../prisma/migrations/20260807233000_hosted_max_plan_transition_bridge/migration.sql\",
    import.meta.url,
  ),
  \"utf8\",
);

describe(\"Max usage-plan transition bridge migration\", () => {
  it(\"recognizes every directed paid upgrade into Max without replacing the bridge\", () => {
    expect(migrationSql).toContain(
      \"CREATE OR REPLACE FUNCTION capture_hosted_member_usage_plan_transition()\",
    );
    expect(migrationSql).toContain(
      \"OLD.current_billing_plan_code = 'launch_edge_monthly'\",
    );
    expect(migrationSql).toContain(
      \"NEW.current_billing_plan_code = 'launch_max_monthly'\",
    );
    expect(migrationSql).toContain(
      \"'launch_edge_monthly',\\n          'launch_max_monthly'\",
    );
    expect(migrationSql).not.toMatch(/DROP\\s+(?:TRIGGER|FUNCTION)/iu);
  });
});
""",
    encoding="utf-8",
)

# Final text hygiene across the complete PR surface.
paths = subprocess.check_output(
    ["git", "diff", "--name-only", "origin/main"],
    cwd=ROOT,
    text=True,
).splitlines()
text_suffixes = {".css", ".json", ".md", ".prisma", ".py", ".sql", ".ts", ".tsx", ".yml", ".yaml"}
for relative in paths:
    path = ROOT / relative
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    data = path.read_bytes()
    if data and not data.endswith(b"\n"):
        path.write_bytes(data + b"\n")

print("Applied Max final-audit fixes.")
