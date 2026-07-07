"use client";

import { useState, type ComponentProps } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { buttonVariants } from "@/src/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/src/components/ui/combobox";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/src/components/ui/drawer";
import { Input } from "@/src/components/ui/input";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

export interface PhoneNumberCountryOption {
  code: string;
  dialCode: string;
  label: string;
  placeholder: string;
}

export function PhoneNumberInput({
  autoComplete = "tel-national",
  autoFocus = false,
  className,
  id,
  inputClassName,
  inputMode = "tel",
  inputName = "phone-number",
  inputSize = "xl",
  options,
  selectedCountry,
  value,
  onCountryChange,
  onPhoneNumberChange,
}: {
  autoComplete?: string;
  autoFocus?: boolean;
  className?: string;
  id: string;
  inputClassName?: string;
  inputMode?: "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
  inputName?: string;
  inputSize?: ComponentProps<typeof Input>["inputSize"];
  options: PhoneNumberCountryOption[];
  selectedCountry: PhoneNumberCountryOption;
  value: string;
  onCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
      <CountryCodePicker
        options={options}
        selectedCountry={selectedCountry}
        onCountryChange={onCountryChange}
      />
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        name={inputName}
        placeholder={selectedCountry.placeholder}
        inputSize={inputSize}
        value={value}
        onChange={(event) => onPhoneNumberChange(event.currentTarget.value)}
        className={cn("flex-1", inputClassName)}
      />
    </div>
  );
}

const COUNTRY_TRIGGER_CLASS = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-14 w-auto shrink-0 justify-between rounded-2xl px-5 text-left text-base font-medium md:text-base sm:min-w-28",
);

function CountryCodePicker({
  options,
  selectedCountry,
  onCountryChange,
}: {
  options: PhoneNumberCountryOption[];
  selectedCountry: PhoneNumberCountryOption;
  onCountryChange: (code: string) => void;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <CountryCodeDrawer
        options={options}
        selectedCountry={selectedCountry}
        onCountryChange={onCountryChange}
      />
    );
  }

  return (
    <Combobox
      items={options}
      value={selectedCountry}
      itemToStringValue={(option) =>
        `${option.label} ${option.dialCode} ${option.dialCode.replace("+", "")}`
      }
      onValueChange={(option) => {
        if (option) {
          onCountryChange(option.code);
        }
      }}
    >
      <ComboboxTrigger
        aria-label={`Country or region, ${selectedCountry.label} ${selectedCountry.dialCode}`}
        className={COUNTRY_TRIGGER_CLASS}
      >
        {selectedCountry.dialCode}
      </ComboboxTrigger>
      <ComboboxContent className="w-64">
        <ComboboxInput placeholder="Search countries..." />
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option.code} value={option}>
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.dialCode}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function CountryCodeDrawer({
  options,
  selectedCountry,
  onCountryChange,
}: {
  options: PhoneNumberCountryOption[];
  selectedCountry: PhoneNumberCountryOption;
  onCountryChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const digits = search.replace(/[^0-9]/g, "");
  const normalizedSearch = search.toLowerCase();
  const filtered = search
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(normalizedSearch) ||
          (digits.length > 0 && option.dialCode.replace("+", "").startsWith(digits)),
      )
    : options;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={`Country or region, ${selectedCountry.label} ${selectedCountry.dialCode}`}
          className={COUNTRY_TRIGGER_CLASS}
        >
          {selectedCountry.dialCode}
          <ChevronDownIcon className="pointer-events-none size-4 text-stone-500" />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="flex flex-col pb-12">
          <div className="sticky top-0 border-b border-border bg-popover px-4 py-3">
            <input
              autoFocus
              type="text"
              placeholder="Search countries..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="overflow-y-auto overscroll-contain">
            {filtered.map((option) => (
              <button
                key={option.code}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-3.5 text-left text-base transition-colors active:bg-muted",
                  option.code === selectedCountry.code
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => {
                  onCountryChange(option.code);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="flex-1">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.dialCode}
                </span>
                {option.code === selectedCountry.code && (
                  <CheckIcon className="size-4 shrink-0 text-foreground" />
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No countries found
              </p>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
