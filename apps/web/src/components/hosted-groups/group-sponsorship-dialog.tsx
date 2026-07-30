"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpDialogProps,
  type HostedUsageTopUpOffer,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { RadioGroup } from "@/src/components/ui/radio-group";
import { Textarea } from "@/src/components/ui/textarea";

type GroupSponsorshipDialogProps = Omit<
  HostedUsageTopUpDialogProps,
  "buildCheckoutPayload" | "offers" | "renderSelectionDetails" | "scope"
> & {
  customizationAllowed: boolean;
  frozenSponsorship?: FrozenGroupSponsorship | null;
  mode?: "monthly" | "one_time";
  monthlyCapMinor?: 500 | 1_000 | 2_000;
  monthlyCapOptions?: readonly GroupSponsorshipMonthlyCapOption[];
  offers: readonly GroupSponsorshipOffer[];
};

type FrozenGroupSponsorship = {
  publicAlias: string | null;
  runningBitRequest: string | null;
  sponsorMessage: string | null;
};

type GroupSponsorshipOffer = HostedUsageTopUpOffer & {
  runningBitDurationLabel: string | null;
};

type GroupSponsorshipMonthlyCapOption = {
  amountLabel: string;
  monthlyCapMinor: 500 | 1_000 | 2_000;
};

function GroupSponsorshipDialog({
  customizationAllowed,
  frozenSponsorship,
  mode = "one_time",
  monthlyCapMinor,
  monthlyCapOptions = [],
  offers,
  ...props
}: GroupSponsorshipDialogProps) {
  const [publicAlias, setPublicAlias] = useState(
    frozenSponsorship?.publicAlias ?? "",
  );
  const [runningBitRequest, setRunningBitRequest] = useState(
    frozenSponsorship?.runningBitRequest ?? "",
  );
  const [sponsorMessage, setSponsorMessage] = useState(
    frozenSponsorship?.sponsorMessage ?? "",
  );
  const [selectedMonthlyCapMinor, setSelectedMonthlyCapMinor] = useState(
    monthlyCapMinor ?? monthlyCapOptions[0]?.monthlyCapMinor ?? 500,
  );
  const recoveringFrozenPurchase =
    props.activePurchase != null && frozenSponsorship !== undefined;

  return (
    <HostedUsageTopUpDialog
      {...props}
      groupPaymentMode={mode}
      scope="group"
      offers={offers}
      buildCheckoutPayload={({ clientRequestKey, offerCode }) => {
        if (recoveringFrozenPurchase) {
          return {
            clientRequestKey,
            offerCode,
            ...(mode === "monthly"
              ? {
                  monthlyCapMinor: selectedMonthlyCapMinor,
                  sponsorshipKind: "monthly",
                }
              : { sponsorshipKind: "one_time" }),
            sponsorship: frozenSponsorship ?? {},
          };
        }
        const base = {
          clientRequestKey,
          offerCode,
          ...(mode === "monthly"
            ? {
                monthlyCapMinor: selectedMonthlyCapMinor,
                sponsorshipKind: "monthly",
              }
            : { sponsorshipKind: "one_time" }),
        };
        return customizationAllowed
          ? {
              ...base,
              sponsorship: {
                publicAlias,
                sponsorMessage,
                ...(readRunningBitDurationLabel({
                  mode,
                  offerCode,
                  offers,
                })
                  ? { runningBitRequest }
                  : {}),
              },
            }
          : base;
      }}
      renderPurchaseDetails={
        recoveringFrozenPurchase
          ? <FrozenSponsorshipDetails sponsorship={frozenSponsorship ?? null} />
          : null
      }
      renderSelectionDetails={({ disabled, selectedOffer }) => {
        const runningBitDurationLabel = readRunningBitDurationLabel({
          mode,
          offerCode: selectedOffer?.offerCode ?? null,
          offers,
        });
        return (
          <div className="space-y-4">
            {mode === "monthly" ? (
              <FieldSet
                className="space-y-3"
                disabled={disabled || recoveringFrozenPurchase}
              >
                <FieldLegend>Monthly maximum</FieldLegend>
                <FieldDescription>
                  Murph may make ordinary $5 usage-credit purchases only when
                  this chat needs them, up to the maximum you authorize.
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
                  {monthlyCapOptions.map((option) => (
                    <ChoiceCard
                      key={option.monthlyCapMinor}
                      id={`group-sponsorship-cap-${option.monthlyCapMinor}`}
                      value={String(option.monthlyCapMinor)}
                      disabled={disabled || recoveringFrozenPurchase}
                      title={option.amountLabel}
                      description="per month"
                    />
                  ))}
                </RadioGroup>
              </FieldSet>
            ) : null}
            {customizationAllowed ? <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between"
                  disabled={disabled}
                />
              }
            >
              Add a note (optional)
              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="h-auto">
              <FieldGroup className="pt-4">
                <Field data-disabled={disabled || undefined}>
                  <FieldLabel htmlFor="group-sponsor-alias">
                    Credit me as
                  </FieldLabel>
                  <Input
                    id="group-sponsor-alias"
                    className="focus-visible:ring-0"
                    value={publicAlias}
                    onChange={(event) => setPublicAlias(event.target.value)}
                    maxLength={80}
                    disabled={disabled}
                    placeholder="Jake’s Lower Back"
                  />
                  <FieldDescription>
                    Optional. Murph never guesses your public name.
                  </FieldDescription>
                </Field>
                <Field data-disabled={disabled || undefined}>
                  <FieldLabel htmlFor="group-sponsor-message">
                    Note to Murph or the group
                  </FieldLabel>
                  <Textarea
                    id="group-sponsor-message"
                    className="focus-visible:ring-0"
                    value={sponsorMessage}
                    onChange={(event) => setSponsorMessage(event.target.value)}
                    maxLength={280}
                    disabled={disabled}
                    placeholder="Please stop inviting Jake to basketball."
                  />
                </Field>
                {runningBitDurationLabel ? (
                  <Field data-disabled={disabled || undefined}>
                    <FieldLabel htmlFor="group-sponsor-bit">
                      Temporary running bit
                    </FieldLabel>
                    <Textarea
                      id="group-sponsor-bit"
                      className="focus-visible:ring-0"
                      value={runningBitRequest}
                      onChange={(event) =>
                        setRunningBitRequest(event.target.value)
                      }
                      maxLength={240}
                      disabled={disabled}
                      placeholder="Treat me like Murph’s exhausted CFO."
                    />
                    <FieldDescription>
                      Lasts for {runningBitDurationLabel}.
                      Murph may remix or ignore it. Serious, private, and health
                      conversations always take priority.
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </CollapsibleContent>
            </Collapsible> : null}
          </div>
        );
      }}
    />
  );
}

function readRunningBitDurationLabel(input: {
  mode: "monthly" | "one_time";
  offerCode: string | null;
  offers: readonly GroupSponsorshipOffer[];
}): string | null {
  if (input.mode === "monthly") {
    return null;
  }
  return input.offers.find(
    (offer) => offer.offerCode === input.offerCode,
  )?.runningBitDurationLabel ?? null;
}

function FrozenSponsorshipDetails({
  sponsorship,
}: {
  sponsorship: FrozenGroupSponsorship | null;
}) {
  const details = sponsorship
    ? [
        ["Sponsor name", sponsorship.publicAlias],
        ["Note", sponsorship.sponsorMessage],
        ["Running bit", sponsorship.runningBitRequest],
      ].filter((entry): entry is [string, string] => entry[1] !== null)
    : [];
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-5">
      <p className="text-sm font-medium text-foreground">
        {details.length > 0
          ? "Your original sponsor details are still attached"
          : "No sponsor details were added"}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {details.length > 0
          ? "Cancel this payment before changing them."
          : "No sponsor name, note, or running bit is attached. Cancel this payment before adding any."}
      </p>
      {details.length > 0 ? (
        <dl className="mt-3 space-y-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export { GroupSponsorshipDialog };
export type {
  FrozenGroupSponsorship,
  GroupSponsorshipDialogProps,
  GroupSponsorshipMonthlyCapOption,
  GroupSponsorshipOffer,
};
