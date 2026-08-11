"use client";

import {
  useId,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpDialogProps,
  type HostedUsageTopUpOffer,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
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
import {
  buildHostedGroupSponsorshipDraftInput,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
  type HostedGroupSponsorshipCreativeFormat,
  type HostedGroupSponsorshipDraft,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";
import { cn } from "@/src/lib/utils";

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

type FrozenGroupSponsorship = HostedGroupSponsorshipDraft;

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
  const fieldId = useId();
  const frozenCreativeRequest = frozenSponsorship?.creativeRequest ?? null;
  const [publicAlias, setPublicAlias] = useState(
    frozenSponsorship?.publicAlias ?? "",
  );
  const [runningBitRequest, setRunningBitRequest] = useState(
    frozenSponsorship?.runningBitRequest ?? "",
  );
  const [creativeEnabled, setCreativeEnabled] = useState(
    frozenCreativeRequest !== null || frozenSponsorship?.sponsorMessage != null,
  );
  const [creativeFormat, setCreativeFormat] =
    useState<HostedGroupSponsorshipCreativeFormat>(
      frozenCreativeRequest?.format
        ?? "message",
    );
  const [creativePrompt, setCreativePrompt] = useState(
    frozenCreativeRequest?.prompt ?? frozenSponsorship?.sponsorMessage ?? "",
  );
  const [creativeStyleRequest, setCreativeStyleRequest] = useState(
    frozenCreativeRequest?.styleRequest ?? "",
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
              sponsorship: buildHostedGroupSponsorshipDraftInput({
                creativeEnabled,
                creativeFormat,
                creativePrompt,
                creativeStyleRequest,
                publicAlias,
                runningBitAvailable: Boolean(readRunningBitDurationLabel({
                  mode,
                  offerCode,
                  offers,
                })),
                runningBitRequest,
              }),
            }
          : base;
      }}
      renderPurchaseDetails={
        recoveringFrozenPurchase
          ? <FrozenSponsorshipDetails sponsorship={frozenSponsorship ?? null} />
          : null
      }
      renderSelectionDetails={({
        disabled,
        mobileStickyActionVisible,
        selectedOffer,
      }) => {
        const runningBitDurationLabel = readRunningBitDurationLabel({
          mode,
          offerCode: selectedOffer?.offerCode ?? null,
          offers,
        });
        const publicAliasUsed =
          creativeEnabled ||
          Boolean(
            runningBitDurationLabel && runningBitRequest.trim().length > 0,
          );
        return (
          <div
            className="space-y-4 max-md:flex max-md:flex-1 max-md:flex-col max-md:space-y-0"
            data-slot="group-sponsorship-selection-details"
          >
            {mode === "monthly" ? (
              <FieldSet
                className="space-y-3 max-md:flex max-md:flex-1 max-md:flex-col max-md:space-y-0"
                disabled={disabled || recoveringFrozenPurchase}
              >
                <FieldLegend className="max-md:sr-only">
                  Monthly maximum
                </FieldLegend>
                <GroupSponsorshipCapDial
                  disabled={disabled || recoveringFrozenPurchase}
                  onValueChange={setSelectedMonthlyCapMinor}
                  options={monthlyCapOptions}
                  value={selectedMonthlyCapMinor}
                />
                <RadioGroup
                  value={String(selectedMonthlyCapMinor)}
                  onValueChange={(value) => {
                    const parsed = Number(value);
                    if (parsed === 500 || parsed === 1_000 || parsed === 2_000) {
                      setSelectedMonthlyCapMinor(parsed);
                    }
                  }}
                  className="hidden gap-3 md:grid md:grid-cols-3"
                >
                  {monthlyCapOptions.map((option) => (
                    <ChoiceCard
                      key={option.monthlyCapMinor}
                      className="[&>[data-slot=field]]:gap-2 [&>[data-slot=field]]:p-4 [&_[data-slot=field-content]]:gap-1"
                      id={`${fieldId}-cap-${option.monthlyCapMinor}`}
                      value={String(option.monthlyCapMinor)}
                      disabled={disabled || recoveringFrozenPurchase}
                      title={
                        <span className="font-serif text-3xl font-semibold leading-none tabular-nums">
                          {option.amountLabel}
                        </span>
                      }
                      description={
                        <span className="whitespace-nowrap text-sm font-medium text-muted-foreground">
                          per month
                        </span>
                      }
                    />
                  ))}
                </RadioGroup>
              </FieldSet>
            ) : null}
            {customizationAllowed ? (
              <Collapsible className="max-md:mt-4">
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
                  Personalize (optional)
                  <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
                </CollapsibleTrigger>
                <CollapsibleContent
                  className={cn(
                    "h-auto",
                    mobileStickyActionVisible && "max-md:pb-24",
                  )}
                >
                  <FieldGroup className="pt-4">
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="flex items-start gap-3 p-4">
                        <Checkbox
                          checked={creativeEnabled}
                          className="mt-0.5 size-5"
                          disabled={disabled}
                          id={`${fieldId}-creative-enabled`}
                          onCheckedChange={setCreativeEnabled}
                        />
                        <label
                          className="min-w-0 cursor-pointer"
                          htmlFor={`${fieldId}-creative-enabled`}
                        >
                          <span className="block text-sm font-medium text-foreground">
                            Send something to the group
                          </span>
                          <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                            Choose a message, poem, or 15-second song. Otherwise
                            the sponsorship stays quiet in the chat.
                          </span>
                        </label>
                      </div>

                      {creativeEnabled ? (
                        <div className="space-y-4 border-t border-border p-4">
                          <FieldSet disabled={disabled}>
                            <FieldLegend>Format</FieldLegend>
                            <RadioGroup
                              className="grid gap-2 sm:grid-cols-3"
                              value={creativeFormat}
                              onValueChange={(value) => {
                                if (isCreativeFormat(value)) {
                                  setCreativeFormat(value);
                                }
                              }}
                            >
                              <ChoiceCard
                                description="A short note for the room."
                                disabled={disabled}
                                id={`${fieldId}-creative-message`}
                                title="Message"
                                value="message"
                              />
                              <ChoiceCard
                                description="A few original lines."
                                disabled={disabled}
                                id={`${fieldId}-creative-poem`}
                                title="Poem"
                                value="poem"
                              />
                              <ChoiceCard
                                description="A 15-second group theme."
                                disabled={disabled}
                                id={`${fieldId}-creative-song`}
                                title="Song"
                                value="song"
                              />
                            </RadioGroup>
                          </FieldSet>

                          <Field data-disabled={disabled || undefined}>
                            <FieldLabel htmlFor={`${fieldId}-creative-prompt`}>
                              What should it be about?
                            </FieldLabel>
                            <Textarea
                              id={`${fieldId}-creative-prompt`}
                              className="focus-visible:ring-0"
                              value={creativePrompt}
                              onChange={(event) =>
                                setCreativePrompt(event.target.value)
                              }
                              maxLength={
                                HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS
                              }
                              disabled={disabled}
                              placeholder="Make it this group’s theme and use our latest running joke."
                            />
                            <FieldDescription>
                              Optional. Murph also uses safe, recent group context.
                            </FieldDescription>
                          </Field>

                          {creativeFormat === "song" ? (
                            <Field data-disabled={disabled || undefined}>
                              <FieldLabel htmlFor={`${fieldId}-creative-style`}>
                                Genre or style reference
                              </FieldLabel>
                              <Input
                                id={`${fieldId}-creative-style`}
                                className="focus-visible:ring-0"
                                value={creativeStyleRequest}
                                onChange={(event) =>
                                  setCreativeStyleRequest(event.target.value)
                                }
                                maxLength={
                                  HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS
                                }
                                disabled={disabled}
                                placeholder="Warm ensemble-sitcom theme with a bright acoustic intro"
                              />
                              <FieldDescription>
                                Named references become broad traits like mood,
                                tempo, and instrumentation—not a copied melody,
                                lyric, or signature arrangement.
                              </FieldDescription>
                            </Field>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {runningBitDurationLabel ? (
                      <Field data-disabled={disabled || undefined}>
                        <FieldLabel htmlFor={`${fieldId}-running-bit`}>
                          Temporary running bit
                        </FieldLabel>
                        <Textarea
                          id={`${fieldId}-running-bit`}
                          className="focus-visible:ring-0"
                          value={runningBitRequest}
                          onChange={(event) =>
                            setRunningBitRequest(event.target.value)
                          }
                          maxLength={
                            HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS
                          }
                          disabled={disabled}
                          placeholder="Treat me like Murph’s exhausted CFO."
                        />
                        <FieldDescription>
                          Lasts for {runningBitDurationLabel}. Murph may remix or
                          ignore it. Serious, private, and health conversations
                          always take priority.
                        </FieldDescription>
                      </Field>
                    ) : null}

                    {publicAliasUsed ? (
                      <Field data-disabled={disabled || undefined}>
                        <FieldLabel htmlFor={`${fieldId}-alias`}>
                          Credit it as
                        </FieldLabel>
                        <Input
                          id={`${fieldId}-alias`}
                          className="focus-visible:ring-0"
                          value={publicAlias}
                          onChange={(event) => setPublicAlias(event.target.value)}
                          maxLength={
                            HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS
                          }
                          disabled={disabled}
                          placeholder="The Group Historian"
                        />
                        <FieldDescription>
                          Used only with the creative response or temporary
                          running bit. Murph never guesses your public name.
                        </FieldDescription>
                      </Field>
                    ) : null}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        );
      }}
    />
  );
}

function isCreativeFormat(
  value: string,
): value is HostedGroupSponsorshipCreativeFormat {
  return value === "message" || value === "poem" || value === "song";
}

const CAP_DIAL_SIZE = 280;
const CAP_DIAL_CENTER = CAP_DIAL_SIZE / 2;
const CAP_DIAL_RADIUS = 118;
const CAP_DIAL_START_DEGREES = 300;
const CAP_DIAL_SWEEP_DEGREES = 300;

function GroupSponsorshipCapDial({
  disabled,
  onValueChange,
  options,
  value,
}: {
  disabled: boolean;
  onValueChange: (value: 500 | 1_000 | 2_000) => void;
  options: readonly GroupSponsorshipMonthlyCapOption[];
  value: 500 | 1_000 | 2_000;
}) {
  const labelId = useId();
  const interactionHintId = useId();
  const [dragSweepDegrees, setDragSweepDegrees] = useState<number | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.monthlyCapMinor === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];

  if (!selectedOption) {
    return null;
  }

  const selectedFraction =
    options.length > 1 ? selectedIndex / (options.length - 1) : 0;
  const selectedSweepDegrees =
    CAP_DIAL_SWEEP_DEGREES * selectedFraction;
  const visibleSweepDegrees = dragSweepDegrees ?? selectedSweepDegrees;
  const markerPoints = options.map((_, index) =>
    readCapDialPoint(
      CAP_DIAL_START_DEGREES +
        (CAP_DIAL_SWEEP_DEGREES * index) / Math.max(options.length - 1, 1),
    ),
  );
  const selectedPoint = readCapDialPoint(
    CAP_DIAL_START_DEGREES + visibleSweepDegrees,
  );

  function readPointerSweep(event: PointerEvent<HTMLDivElement>) {
    if (disabled) {
      return null;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * CAP_DIAL_SIZE;
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * CAP_DIAL_SIZE;
    return readCapDialSweepDegrees(pointerX, pointerY);
  }

  function commitNearestOption(sweepDegrees: number) {
    const nearestIndex = Math.round(
      (sweepDegrees / CAP_DIAL_SWEEP_DEGREES) *
        Math.max(options.length - 1, 0),
    );
    const nextOption = options[nearestIndex];
    if (nextOption) {
      onValueChange(nextOption.monthlyCapMinor);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    let nextIndex = selectedIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(options.length - 1, selectedIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, selectedIndex - 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextOption = options[nextIndex];
    if (nextOption) {
      onValueChange(nextOption.monthlyCapMinor);
    }
  }

  return (
    <div className="flex min-h-[24rem] flex-1 items-center justify-center py-4 md:hidden">
      <div
        aria-describedby={interactionHintId}
        aria-disabled={disabled || undefined}
        aria-labelledby={labelId}
        aria-valuemax={20}
        aria-valuemin={5}
        aria-valuenow={selectedOption.monthlyCapMinor / 100}
        aria-valuetext={`Up to ${selectedOption.amountLabel} per month`}
        className="relative aspect-square w-[calc(100%+2rem)] max-w-96 shrink-0 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled=true]:opacity-55"
        data-disabled={disabled ? "true" : undefined}
        onKeyDown={handleKeyDown}
        onPointerCancel={(event) => {
          setDragSweepDegrees(null);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragSweepDegrees(readPointerSweep(event));
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            setDragSweepDegrees(readPointerSweep(event));
          }
        }}
        onPointerUp={(event) => {
          const finalSweepDegrees =
            readPointerSweep(event) ?? dragSweepDegrees;
          if (finalSweepDegrees !== null) {
            commitNearestOption(finalSweepDegrees);
          }
          setDragSweepDegrees(null);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${CAP_DIAL_SIZE} ${CAP_DIAL_SIZE}`}
        >
          <path
            d={readCapDialArcPath(CAP_DIAL_SWEEP_DEGREES)}
            className="text-muted"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="22"
          />
          {visibleSweepDegrees > 0 ? (
            <path
              d={readCapDialArcPath(visibleSweepDegrees)}
              className="text-primary"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="22"
            />
          ) : null}
          {markerPoints.map((point, index) => (
            <circle
              key={options[index]?.monthlyCapMinor}
              className={
                index <= selectedIndex ? "fill-primary" : "fill-border"
              }
              cx={point.x}
              cy={point.y}
              r="4"
            />
          ))}
          <circle
            className="fill-popover stroke-primary"
            cx={selectedPoint.x}
            cy={selectedPoint.y}
            r="14"
            strokeWidth="3"
          />
          <circle
            className="fill-primary"
            cx={selectedPoint.x}
            cy={selectedPoint.y}
            r="7"
          />
        </svg>
        <div className="pointer-events-none absolute inset-16 flex translate-y-2 flex-col items-center justify-center text-center">
          <span
            id={labelId}
            className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground"
          >
            Monthly maximum
          </span>
          <span className="mt-1 font-serif text-[5.5rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {selectedOption.amountLabel}
          </span>
          <span className="mt-2 text-sm font-medium text-muted-foreground">
            per month
          </span>
        </div>
        <span id={interactionHintId} className="sr-only">
          Drag or tap anywhere around the circle. The value snaps to an
          available monthly maximum.
        </span>
      </div>
    </div>
  );
}

function readCapDialSweepDegrees(pointerX: number, pointerY: number) {
  const rawDegrees =
    ((Math.atan2(
      pointerY - CAP_DIAL_CENTER,
      pointerX - CAP_DIAL_CENTER,
    ) *
      180) /
      Math.PI +
      360) %
    360;
  const arcEndDegrees =
    (CAP_DIAL_START_DEGREES + CAP_DIAL_SWEEP_DEGREES) % 360;

  if (
    rawDegrees >= CAP_DIAL_START_DEGREES ||
    rawDegrees <= arcEndDegrees
  ) {
    const unwrappedDegrees =
      rawDegrees < CAP_DIAL_START_DEGREES
        ? rawDegrees + 360
        : rawDegrees;
    return unwrappedDegrees - CAP_DIAL_START_DEGREES;
  }

  const distanceFromEnd = rawDegrees - arcEndDegrees;
  const distanceFromStart = CAP_DIAL_START_DEGREES - rawDegrees;
  return distanceFromEnd <= distanceFromStart
    ? CAP_DIAL_SWEEP_DEGREES
    : 0;
}

function readCapDialPoint(angleDegrees: number) {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: CAP_DIAL_CENTER + CAP_DIAL_RADIUS * Math.cos(radians),
    y: CAP_DIAL_CENTER + CAP_DIAL_RADIUS * Math.sin(radians),
  };
}

function readCapDialArcPath(sweepDegrees: number) {
  const start = readCapDialPoint(CAP_DIAL_START_DEGREES);
  const end = readCapDialPoint(CAP_DIAL_START_DEGREES + sweepDegrees);
  return [
    `M ${start.x} ${start.y}`,
    `A ${CAP_DIAL_RADIUS} ${CAP_DIAL_RADIUS} 0 ${sweepDegrees > 180 ? 1 : 0} 1 ${end.x} ${end.y}`,
  ].join(" ");
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
  const creativeRequest = sponsorship?.creativeRequest ?? null;
  const details = sponsorship
    ? [
        ["Sponsor name", sponsorship.publicAlias],
        [
          "Creative response",
          creativeRequest ? describeCreativeFormat(creativeRequest.format) : null,
        ],
        ["Creative prompt", creativeRequest?.prompt ?? null],
        ["Genre or style", creativeRequest?.styleRequest ?? null],
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
          : "No sponsor name, creative response, or running bit is attached. Cancel this payment before adding any."}
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

function describeCreativeFormat(
  format: HostedGroupSponsorshipCreativeFormat,
): string {
  switch (format) {
    case "message":
      return "Message";
    case "poem":
      return "Poem";
    case "song":
      return "Song";
  }
}

export { GroupSponsorshipDialog };
export type {
  FrozenGroupSponsorship,
  GroupSponsorshipDialogProps,
  GroupSponsorshipMonthlyCapOption,
  GroupSponsorshipOffer,
};
