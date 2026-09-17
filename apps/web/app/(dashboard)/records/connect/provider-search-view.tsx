"use client";

import { ArrowRightIcon, LockKeyholeIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, type RefCallback } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/src/components/ui/avatar";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Spinner } from "@/src/components/ui/spinner";
import type { ClinicalProviderSearchResultContract } from "@/src/lib/clinical-records/client-contracts";
import providerLogos from "@/src/lib/clinical-records/provider-logos.json";

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
  const titleId = `${id}-title`;
  const locked = Boolean(props.startingProviderId || props.selectedProviderId);
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="font-serif text-3xl font-medium tracking-tight text-balance">
          Find your hospital or clinic
        </h2>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          Use the name on your patient portal. You can also search by city or ZIP code.
        </p>
      </div>

      <form role="search" className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}>
        <label htmlFor={inputId} className="sr-only">Hospital or clinic</label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={inputId}
              name="provider-search"
              autoComplete="off"
              defaultValue={props.query}
              inputSize="lg"
              maxLength={120}
              required
              placeholder="Hospital, clinic, city, or ZIP"
              className="pr-12 pl-12"
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
              <Button type="button" variant="ghost" size="icon" aria-label="Clear hospital search" className="absolute top-1/2 right-1 -translate-y-1/2" onClick={(event) => {
                const input = event.currentTarget.closest("form")?.querySelector<HTMLInputElement>("input");
                if (input) { input.value = ""; input.focus(); }
                props.onQueryChange("");
              }}><XIcon aria-hidden="true" /></Button>
            ) : null}
          </div>
          <Button type="submit" size="lg" variant="outline" disabled={locked || props.searchPending}>Search</Button>
        </div>
      </form>

      {props.startError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not open this portal</AlertTitle>
          <AlertDescription>
            {props.startError}
            <a href="/records/connect?launch=clinical-records" onClick={props.onRestart} className="underline underline-offset-4">Start a new connection</a>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        <p id={statusId} aria-live="polite" className="min-h-4 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
          {props.searchPending ? "Finding your care provider" : props.searchError ? "Search unavailable" : props.hasSearched ? `${props.providers.length} ${props.providers.length === 1 ? "match" : "matches"}` : "Start typing to see matching providers"}
        </p>
        {props.searchError ? (
          <Alert variant="destructive">
            <AlertTitle>Search unavailable</AlertTitle>
            <AlertDescription>{props.searchError}<Button type="button" variant="outline" size="sm" onClick={props.onSearch}>Try again</Button></AlertDescription>
          </Alert>
        ) : null}
        <ul id={resultsId} aria-label="Matching hospitals and clinics" aria-busy={props.searchPending} className="divide-y divide-border">
          {props.providers.map((provider) => (
            <ProviderResult key={provider.id} provider={provider} pending={props.startingProviderId === provider.id}
              disabled={props.searchPending || Boolean(props.startingProviderId) || Boolean(props.selectedProviderId && props.selectedProviderId !== provider.id)}
              onSelect={() => props.onSelect(provider)} />
          ))}
        </ul>
        {props.searchPending && props.providers.length === 0 ? (
          <div aria-hidden="true" className="flex flex-col gap-6 py-2">
            {[0, 1, 2].map((index) => <div key={index} className="flex items-center gap-4"><Skeleton className="size-12 rounded-lg" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}
          </div>
        ) : null}
        {props.hasSearched && !props.searchPending && !props.searchError && props.providers.length === 0 ? (
          <div className="flex flex-col gap-2 py-6">
            <h3 className="font-medium">No matching providers</h3>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">Try another name, city, or ZIP code. Your portal may not be supported yet.</p>
          </div>
        ) : null}
      </div>
      {props.onKeepUpdatedChange ? (
        <Field orientation="horizontal">
          <Checkbox id={`${inputId}-daily`} checked={props.keepUpdated ?? false} onCheckedChange={props.onKeepUpdatedChange} disabled={locked} />
          <FieldContent>
            <FieldLabel htmlFor={`${inputId}-daily`}>Check for new records daily</FieldLabel>
            <FieldDescription>Where your portal supports ongoing access. You choose the access period at your portal and can disconnect in Murph anytime. Otherwise, this is a one-time import.</FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
      <p className="flex items-start gap-2 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
        <LockKeyholeIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        You’ll sign in on your provider’s website and choose what to share with Murph.
      </p>
    </section>
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
      <button type="button" aria-label={`Continue to ${provider.brandName} patient portal`} aria-busy={pending} disabled={disabled} onClick={onSelect}
        className="group flex w-full items-center gap-4 rounded-lg px-2 py-4 text-left outline-offset-2 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 sm:px-3"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const buttons = [...(event.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
          const index = buttons.indexOf(event.currentTarget);
          const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
          event.preventDefault();
          if (next) next.focus();
          else if (event.key === "ArrowUp") event.currentTarget.closest("section")?.querySelector<HTMLInputElement>("input")?.focus();
        }}>
        <Avatar className="size-12 rounded-lg after:rounded-lg">
          <AvatarImage src={logos[provider.id]} alt="" loading="lazy" className="rounded-lg object-contain" />
          <AvatarFallback className="rounded-lg">{provider.brandName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-pretty sm:text-base">{provider.brandName}</span>
          <span className="text-xs leading-5 text-muted-foreground">{location || "Patient portal"}{locations.length > 2 ? ` +${locations.length - 2} more` : ""}</span>
        </span>
        {pending ? <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><Spinner /><span className="sr-only sm:not-sr-only">Opening portal</span></span> : <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />}
      </button>
    </li>
  );
}
