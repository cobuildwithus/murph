"use client";

import { ChevronRightIcon, XIcon } from "lucide-react";
import { useId, type RefCallback } from "react";

import {
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageError,
  LinkPageLink,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/src/components/ui/avatar";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import providerLogos from "@/src/lib/clinical-records/provider-logos.json";
import { Spinner } from "@/src/components/ui/spinner";
import type { ClinicalProviderSearchResultContract } from "@/src/lib/clinical-records/client-contracts";
import { cn } from "@/src/lib/utils";

const PROVIDER_ROW_CLASS = "rounded-[18px] bg-[#2A2622] px-4 py-3.5";

export interface ProviderSearchViewProps {
  keepUpdated?: boolean;
  onKeepUpdatedChange?: (checked: boolean) => void;
  query: string;
  providers: readonly ClinicalProviderSearchResultContract[];
  hasSearched: boolean;
  searchPending: boolean;
  searchError: string | null;
  startError: string | null;
  startingProviderId: string | null;
  selectedProviderId: string | null;
  inputRef?: RefCallback<HTMLInputElement>;
  onQueryChange: (value: string, composing?: boolean) => void;
  onSearch: () => void;
  onSelect: (provider: ClinicalProviderSearchResultContract) => void;
  onRestart: () => void;
}

export function ProviderSearchView({ inputRef, ...props }: ProviderSearchViewProps) {
  const id = useId();
  const inputId = `${id}-search`;
  const resultsId = `${id}-results`;
  const statusId = `${id}-status`;
  const locked = Boolean(props.startingProviderId || props.selectedProviderId);
  const noMatches = props.hasSearched && !props.searchPending && !props.searchError && props.providers.length === 0;
  const atRest = !props.searchPending && !props.searchError && !props.hasSearched;

  return (
    <LinkPageScreen
      actions={props.onKeepUpdatedChange && !noMatches ? (
        <label
          className={cn(PROVIDER_ROW_CLASS, "flex w-full items-center gap-3")}
          htmlFor={`${inputId}-daily`}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[17px] font-semibold leading-[22px]">
              Check for new records daily
            </span>
            <span className="text-sm font-medium leading-[19px] text-[#FFFCF6]/60">
              Where your portal supports ongoing access. You choose the access period at your portal and can disconnect in Murph anytime. Otherwise, this is a one-time import.
            </span>
          </span>
          <Checkbox
            checked={props.keepUpdated ?? false}
            className="size-[26px] rounded-full border-[1.5px] border-[#FFFCF6]/35 data-checked:border-[#FFFCF6] data-checked:bg-[#FFFCF6] data-checked:text-[#2D3436] [&_svg]:size-4"
            disabled={locked}
            id={`${inputId}-daily`}
            onCheckedChange={props.onKeepUpdatedChange}
          />
        </label>
      ) : undefined}
      announceDetail={false}
      below={
        <div className="flex flex-col pt-[18px]" style={LINK_PAGE_NIGHT_TOKENS}>
          <form
            role="search"
            onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}
          >
            <label htmlFor={inputId} className="sr-only">Hospital or clinic</label>
            <div className="relative">
              <Input
                id={inputId}
                name="provider-search"
                autoComplete="off"
                defaultValue={props.query}
                inputSize="lg"
                maxLength={120}
                required
                placeholder="Name, city, or ZIP code"
                className="h-14 rounded-[18px] border-0 bg-[#2A2622] pr-12 pl-[18px] text-[17px] font-medium text-[#FFFCF6] placeholder:text-[#FFFCF6]/50"
                aria-controls={resultsId}
                aria-describedby={statusId}
                ref={inputRef}
                readOnly={locked}
                onInput={(event) => props.onQueryChange(event.currentTarget.value, "isComposing" in event.nativeEvent && Boolean(event.nativeEvent.isComposing))}
                onCompositionEnd={(event) => props.onQueryChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  const first = event.currentTarget.closest("section")?.querySelector<HTMLButtonElement>("ul button:not(:disabled)");
                  if (first) { event.preventDefault(); first.focus(); }
                }}
              />
              {props.query && !locked ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  aria-label="Clear hospital search"
                  className="absolute top-1/2 right-1.5 flex size-11 -translate-y-1/2 items-center justify-center text-[#FFFCF6]/60"
                  onClick={(event) => {
                    const input = event.currentTarget.closest("form")?.querySelector<HTMLInputElement>("input");
                    if (input) { input.value = ""; input.focus(); }
                    props.onQueryChange("");
                  }}
                >
                  <XIcon aria-hidden="true" className="size-5" />
                </Button>
              ) : null}
            </div>
            <button className="sr-only" disabled={locked || props.searchPending} type="submit">
              Search
            </button>
          </form>

          {props.startError ? (
            <div className="flex flex-col items-center pt-3">
              <LinkPageError>{props.startError}</LinkPageError>
              <a
                className={LINK_PAGE_LINK_CLASS}
                href="/records/connect?launch=clinical-records"
                onClick={props.onRestart}
              >
                Start a new connection
              </a>
            </div>
          ) : null}

          <p
            id={statusId}
            aria-live="polite"
            className={atRest || noMatches
              ? "sr-only"
              : "px-0.5 pt-[18px] pb-2.5 text-sm font-semibold leading-5 tabular-nums text-[#FFFCF6]/60"}
          >
            {noMatches
              ? "No matching providers"
              : props.searchPending
                ? "Finding your care provider"
                : props.searchError
                  ? "Search unavailable"
                  : props.hasSearched
                    ? `${props.providers.length} ${props.providers.length === 1 ? "match" : "matches"}`
                    : "Start typing to see matching providers"}
          </p>
          {props.searchError ? (
            <div className="flex flex-col items-center">
              <LinkPageError>{props.searchError}</LinkPageError>
              <LinkPageLink onClick={props.onSearch}>Try again</LinkPageLink>
            </div>
          ) : null}
          <ul
            id={resultsId}
            aria-label="Matching hospitals and clinics"
            aria-busy={props.searchPending}
            className="flex flex-col gap-2"
          >
            {props.providers.map((provider) => (
              <ProviderResult
                key={provider.id}
                provider={provider}
                pending={props.startingProviderId === provider.id}
                disabled={props.searchPending || Boolean(props.startingProviderId) || Boolean(props.selectedProviderId && props.selectedProviderId !== provider.id)}
                onSelect={() => props.onSelect(provider)}
              />
            ))}
          </ul>
          {props.searchPending && props.providers.length === 0 ? (
            <div aria-hidden="true" className="flex flex-col gap-2">
              {[0, 1, 2].map((index) => (
                <Skeleton className="h-[72px] rounded-[18px]" key={index} />
              ))}
            </div>
          ) : null}
          {noMatches ? (
            <p className="pt-[18px] text-base font-medium leading-[22px] text-[#FFFCF6]/60">
              Try another name, city, or ZIP code. Your portal may not be supported yet.
            </p>
          ) : null}
        </div>
      }
      detail={props.hasSearched
        ? undefined
        : "You’ll sign in on your provider’s website and choose what to share with Murph."}
      title="Find your hospital or clinic."
    />
  );
}

function ProviderResult({ provider, disabled, pending, onSelect }: {
  provider: ClinicalProviderSearchResultContract;
  disabled: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const logos: Readonly<Record<string, string>> = providerLogos;
  const locations = [...new Set(provider.facilities.map((facility) => [facility.city, facility.state].filter(Boolean).join(", ")).filter(Boolean))];
  const location = locations.slice(0, 2).join(" · ");
  return (
    <li>
      <button
        type="button"
        aria-label={`Continue to ${provider.brandName} patient portal`}
        aria-busy={pending}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          PROVIDER_ROW_CLASS,
          "flex w-full items-center gap-3 text-left outline-offset-2 transition-opacity focus-visible:outline-2 focus-visible:outline-[#FFFCF6]/70 disabled:pointer-events-none disabled:opacity-50",
        )}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const buttons = [...(event.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
          const index = buttons.indexOf(event.currentTarget);
          const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
          event.preventDefault();
          if (next) next.focus();
          else if (event.key === "ArrowUp") event.currentTarget.closest("section")?.querySelector<HTMLInputElement>("input")?.focus();
        }}
      >
        <Avatar className="h-11 w-16 shrink-0 items-center justify-center rounded-[10px] bg-[#FFFCF6] after:rounded-[10px]">
          <AvatarImage src={logos[provider.id]} alt="" loading="lazy" className="aspect-auto rounded-none object-contain p-1" />
          <AvatarFallback className="rounded-[10px] bg-[#FFFCF6] text-xs font-semibold text-[#2D3436]">
            {provider.brandName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-pretty text-[17px] font-semibold leading-[22px]">{provider.brandName}</span>
          <span className="text-sm font-medium leading-[19px] text-[#FFFCF6]/60">
            {location || "Patient portal"}{locations.length > 2 ? ` +${locations.length - 2} more` : ""}
          </span>
        </span>
        {pending ? (
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-[#FFFCF6]/60">
            <Spinner />
            <span className="sr-only sm:not-sr-only">Opening portal</span>
          </span>
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-[#FFFCF6]/40" />
        )}
      </button>
    </li>
  );
}
