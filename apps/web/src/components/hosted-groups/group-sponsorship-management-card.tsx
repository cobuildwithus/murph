"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { RadioGroup } from "@/src/components/ui/radio-group";

export interface GroupSponsorshipManagementProjection {
  authorizationId: string;
  chargedThisPeriodMinor: number;
  monthlyCapMinor: 500 | 1_000 | 2_000;
  pendingThisPeriodMinor: number;
  pendingMonthlyCapMinor: 500 | 1_000 | 2_000 | null;
  periodEnd: string;
  status: "active" | "paused" | "pending_activation" | "recovery_required";
}

type MonthlyCapMinor = GroupSponsorshipManagementProjection["monthlyCapMinor"];

export function GroupSponsorshipManagementCard({
  endpoint,
  groupName,
  inert = false,
  management: initialManagement,
}: {
  endpoint: string;
  groupName: string;
  inert?: boolean;
  management: GroupSponsorshipManagementProjection;
}) {
  const [management, setManagement] = useState(initialManagement);
  const [selectedMonthlyCapMinor, setSelectedMonthlyCapMinor] = useState(
    initialManagement.pendingMonthlyCapMinor ?? initialManagement.monthlyCapMinor,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: Record<string, unknown>) => {
    if (inert || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          ...body,
          authorizationId: management.authorizationId,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const value: unknown = await response.json();
      if (!response.ok || !isRecord(value)) {
        throw new Error("That change didn’t go through. Try again.");
      }
      if (isRecord(value.checkout)) {
        const checkoutUrl = typeof value.checkout.url === "string"
          ? readHttpsUrl(value.checkout.url)
          : null;
        if (checkoutUrl) {
          window.location.assign(checkoutUrl);
          return;
        }
        window.location.reload();
        return;
      }
      if (value.management === null) {
        window.location.reload();
        return;
      }
      const next = readManagementProjection(value.management);
      if (!next) {
        throw new Error("That change couldn’t be confirmed. Refresh and try again.");
      }
      setManagement(next);
      setSelectedMonthlyCapMinor(
        next.pendingMonthlyCapMinor ?? next.monthlyCapMinor,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That change didn’t go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const appliedMonthlyCapMinor =
    management.pendingMonthlyCapMinor ?? management.monthlyCapMinor;

  const applyCap = () => {
    if (selectedMonthlyCapMinor === appliedMonthlyCapMinor) {
      return;
    }
    if (
      selectedMonthlyCapMinor > management.monthlyCapMinor &&
      !window.confirm(
        `Increase the monthly maximum to ${formatMoney(selectedMonthlyCapMinor)}? Murph may charge additional $5 usage-credit purchases this period when the group needs them.`,
      )
    ) {
      return;
    }
    void submit({
      action: "change_cap",
      confirmed: true,
      monthlyCapMinor: selectedMonthlyCapMinor,
    });
  };

  return (
    <section
      className="space-y-6 rounded-2xl border border-border p-5 sm:p-6"
      data-component="group-sponsorship-management"
    >
      <div className="space-y-1.5">
        <h2 className="font-serif text-xl font-semibold tracking-normal">
          Monthly sponsorship
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Private controls for your sponsorship of {groupName}. The group only
          sees that Murph is sponsored.
        </p>
      </div>

      <dl className="grid gap-4 rounded-2xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Charged this period
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(management.chargedThisPeriodMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(management.pendingThisPeriodMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Monthly maximum
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(management.monthlyCapMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Period ends
          </dt>
          <dd className="mt-1 text-sm font-medium">
            {formatPeriodEnd(management.periodEnd)}
          </dd>
        </div>
      </dl>

      {management.status === "recovery_required" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium">Payment needs attention</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Automatic refills are paused. Review the saved card or finish a
            secure checkout to resume this sponsorship.
          </p>
          <Button
            type="button"
            className="mt-4"
            disabled={busy || inert}
            onClick={() => void submit({ action: "recover" })}
          >
            Review payment
          </Button>
        </div>
      ) : null}

      {management.status !== "pending_activation" ? (
        <FieldSet disabled={busy || inert}>
          <FieldLegend>Monthly maximum</FieldLegend>
          <FieldDescription>
            Select a maximum, then apply it. Increases require your confirmation.
            A decrease below credit already charged or pending this period starts
            next period.
          </FieldDescription>
          <RadioGroup
            value={String(selectedMonthlyCapMinor)}
            onValueChange={(value) => {
              const parsed = Number(value);
              if (parsed === 500 || parsed === 1_000 || parsed === 2_000) {
                setSelectedMonthlyCapMinor(parsed);
              }
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            {([500, 1_000, 2_000] as const).map((monthlyCapMinor) => (
              <ChoiceCard
                key={monthlyCapMinor}
                id={`managed-group-sponsorship-cap-${monthlyCapMinor}`}
                value={String(monthlyCapMinor)}
                disabled={busy || inert}
                title={formatMoney(monthlyCapMinor)}
                description="maximum per month"
              />
            ))}
          </RadioGroup>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              disabled={
                busy ||
                inert ||
                selectedMonthlyCapMinor === appliedMonthlyCapMinor
              }
              onClick={applyCap}
            >
              Apply monthly maximum
            </Button>
            {management.pendingMonthlyCapMinor !== null ? (
              <p className="text-sm text-muted-foreground">
                Next period’s maximum: {formatMoney(management.pendingMonthlyCapMinor)}
              </p>
            ) : null}
          </div>
        </FieldSet>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          The fixed $5 activation purchase is still being confirmed.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
        {management.status === "active" ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || inert}
            onClick={() => void submit({ action: "pause" })}
          >
            Pause automatic refills
          </Button>
        ) : management.status === "paused" ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || inert}
            onClick={() => void submit({ action: "resume" })}
          >
            Resume automatic refills
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={busy || inert}
          onClick={() => {
            if (
              window.confirm(
                "Cancel this monthly sponsorship? Purchased usage credit stays with the group.",
              )
            ) {
              void submit({ action: "cancel" });
            }
          }}
        >
          Cancel sponsorship
        </Button>
      </div>
    </section>
  );
}

function readManagementProjection(
  value: unknown,
): GroupSponsorshipManagementProjection | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value.status;
  const monthlyCapMinor = readCap(value.monthlyCapMinor);
  const pendingMonthlyCapMinor = value.pendingMonthlyCapMinor === null
    ? null
    : readCap(value.pendingMonthlyCapMinor);
  if (
    typeof value.authorizationId !== "string" ||
    !isNonNegativeInteger(value.chargedThisPeriodMinor) ||
    !isNonNegativeInteger(value.pendingThisPeriodMinor) ||
    monthlyCapMinor === null ||
    (value.pendingMonthlyCapMinor !== null && pendingMonthlyCapMinor === null) ||
    typeof value.periodEnd !== "string" ||
    !isCanonicalTimestamp(value.periodEnd) ||
    (status !== "active" &&
      status !== "paused" &&
      status !== "pending_activation" &&
      status !== "recovery_required")
  ) {
    return null;
  }
  return {
    authorizationId: value.authorizationId,
    chargedThisPeriodMinor: value.chargedThisPeriodMinor,
    monthlyCapMinor,
    pendingThisPeriodMinor: value.pendingThisPeriodMinor,
    pendingMonthlyCapMinor,
    periodEnd: value.periodEnd,
    status,
  };
}

function readCap(value: unknown): MonthlyCapMinor | null {
  return value === 500 || value === 1_000 || value === 2_000 ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(minor / 100);
}

function formatPeriodEnd(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    : value;
}

function readHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
