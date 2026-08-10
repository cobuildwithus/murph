"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/src/components/ui/alert";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
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
  cancelOnly = false,
  endpoint,
  inert = false,
  management: initialManagement,
}: {
  cancelOnly?: boolean;
  endpoint: string;
  inert?: boolean;
  management: GroupSponsorshipManagementProjection;
}) {
  const [management, setManagement] = useState(initialManagement);
  const [selectedMonthlyCapMinor, setSelectedMonthlyCapMinor] = useState(
    initialManagement.pendingMonthlyCapMinor ?? initialManagement.monthlyCapMinor,
  );
  const [busy, setBusy] = useState(false);
  const [canceled, setCanceled] = useState(false);
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
        if (body.action === "cancel") {
          setCanceled(true);
          return;
        }
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
  const capChanged = selectedMonthlyCapMinor !== appliedMonthlyCapMinor;
  const capIncrease = selectedMonthlyCapMinor > management.monthlyCapMinor;

  if (canceled) {
    return <GroupSponsorshipCanceledReceipt />;
  }

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
      className="space-y-7"
      data-component="group-sponsorship-management"
    >
      <div className="space-y-2">
        <h2 className="font-serif text-xl font-semibold tracking-normal">
          Monthly sponsorship
        </h2>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Private to you
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            This month
          </dt>
          <dd className="mt-1 font-serif text-2xl font-semibold tabular-nums">
            {formatMoney(management.chargedThisPeriodMinor)}
          </dd>
          {management.pendingThisPeriodMinor > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              +{formatMoney(management.pendingThisPeriodMinor)} processing
            </p>
          ) : null}
        </div>
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Monthly limit
          </dt>
          <dd className="mt-1 font-serif text-2xl font-semibold tabular-nums">
            {formatMoney(management.monthlyCapMinor)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Resets
          </dt>
          <dd className="mt-2 text-sm font-medium">
            {formatPeriodEnd(management.periodEnd)}
          </dd>
        </div>
      </dl>

      {cancelOnly ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Billing changes are unavailable, but you can still stop future automatic refills.
        </p>
      ) : management.status === "recovery_required" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium">Payment needs attention</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Automatic refills are paused until payment is fixed.
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={busy || inert}
            size="sm"
            onClick={() => void submit({ action: "recover" })}
          >
            Review payment
          </Button>
        </div>
      ) : null}

      {!cancelOnly && management.status !== "pending_activation" ? (
        <FieldSet className="space-y-3" disabled={busy || inert}>
          <FieldLegend>Monthly limit</FieldLegend>
          <RadioGroup
            value={String(selectedMonthlyCapMinor)}
            onValueChange={(value) => {
              const parsed = Number(value);
              if (parsed === 500 || parsed === 1_000 || parsed === 2_000) {
                setSelectedMonthlyCapMinor(parsed);
              }
            }}
            className="grid grid-cols-3 gap-2"
          >
            {([500, 1_000, 2_000] as const).map((monthlyCapMinor) => (
              <ChoiceCard
                className="[&>[data-slot=field]]:gap-1 [&>[data-slot=field]]:p-2 [&_[data-slot=field-content]]:gap-1 min-[360px]:[&>[data-slot=field]]:gap-1.5 min-[360px]:[&>[data-slot=field]]:p-3"
                key={monthlyCapMinor}
                id={`managed-group-sponsorship-cap-${monthlyCapMinor}`}
                value={String(monthlyCapMinor)}
                disabled={busy || inert}
                title={(
                  <span className="font-serif text-lg font-semibold leading-none tabular-nums min-[360px]:text-xl sm:text-2xl">
                    {formatMoney(monthlyCapMinor)}
                  </span>
                )}
                description={(
                  <span className="hidden text-xs font-medium text-muted-foreground min-[360px]:inline">
                    per month
                  </span>
                )}
              />
            ))}
          </RadioGroup>
          {capChanged || management.pendingMonthlyCapMinor !== null ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {capChanged ? (
                <Button
                  type="button"
                  disabled={busy || inert}
                  onClick={applyCap}
                  size="sm"
                >
                  {capIncrease
                    ? `Confirm ${formatMoney(selectedMonthlyCapMinor)} limit`
                    : `Save ${formatMoney(selectedMonthlyCapMinor)} limit`}
                </Button>
              ) : null}
              {management.pendingMonthlyCapMinor !== null ? (
                <p className="text-sm text-muted-foreground">
                  {formatMoney(management.pendingMonthlyCapMinor)} starts next
                  month.
                </p>
              ) : null}
            </div>
          ) : null}
        </FieldSet>
      ) : !cancelOnly ? (
        <p className="text-sm leading-6 text-muted-foreground">
          The $5 activation is being confirmed.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {!cancelOnly && management.status === "active" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || inert}
            onClick={() => void submit({ action: "pause" })}
          >
            Pause automatic refills
          </Button>
        ) : !cancelOnly && management.status === "paused" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || inert}
            onClick={() => void submit({ action: "resume" })}
          >
            Resume automatic refills
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
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

export function GroupSponsorshipCanceledReceipt() {
  return (
    <Alert
      data-component="group-sponsorship-management"
      data-state="canceled"
      role="status"
    >
      <AlertTitle>
        Monthly sponsorship canceled
      </AlertTitle>
      <AlertDescription>
        Future automatic refills are stopped. Usage credit already purchased stays with the group.
      </AlertDescription>
    </Alert>
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
