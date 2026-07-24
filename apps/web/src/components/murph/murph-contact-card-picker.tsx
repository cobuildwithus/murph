"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ContactRoundIcon } from "lucide-react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/src/components/ui/drawer";
import { useIsMobile } from "@/src/hooks/use-mobile";
import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  MURPH_CONTACT_AVATAR_OPTIONS,
  type MurphContactAvatarKind,
  type MurphContactAvatarOption,
} from "@/src/lib/murph-contact-avatars";
import { detectInAppBrowser } from "@/src/lib/in-app-browser";
import { isRecord } from "@/src/lib/primitives";
import { cn } from "@/src/lib/utils";

export {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  MURPH_CONTACT_AVATAR_OPTIONS,
  type MurphContactAvatarKind,
  type MurphContactAvatarOption,
};

export function murphContactCardDownloadHref(avatarId: string): string {
  return `/api/murph-contact-card?avatar=${encodeURIComponent(avatarId)}`;
}

function subscribeToBrowserSnapshot() {
  return () => {};
}

function readBrowserServerSnapshot(): string {
  return "";
}

function readBrowserUserAgentSnapshot(): string {
  return navigator.userAgent;
}

export function MurphContactAvatarArt({
  className,
  option,
}: {
  className?: string;
  option: MurphContactAvatarOption;
}) {
  if (option.src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "block shrink-0 overflow-hidden rounded-full bg-cover bg-center",
          className,
        )}
        style={{ backgroundImage: `url('${option.src}')` }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#d4c4a8]",
        className,
      )}
    >
      <span className="font-serif text-[38%] font-semibold leading-none text-[#2d3436]">
        M
      </span>
    </span>
  );
}

export function MurphContactAvatarGrid({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (id: string) => void;
  value: string;
}) {
  const groupName = useId();

  return (
    <div
      aria-label="Murph contact photo"
      className="grid grid-cols-3 gap-x-2 gap-y-4 min-[380px]:grid-cols-4"
      role="radiogroup"
    >
      {MURPH_CONTACT_AVATAR_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <label
            className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl px-1 py-1.5 has-[:disabled]:pointer-events-none has-[:disabled]:cursor-default has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            key={option.id}
          >
            <input
              checked={selected}
              className="sr-only"
              disabled={disabled}
              name={groupName}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <MurphContactAvatarArt
              className={cn(
                "size-14 text-[56px] transition-shadow",
                selected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-popover"
                  : "ring-1 ring-border group-hover:ring-primary/40",
              )}
              option={option}
            />
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.12em]",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function MurphContactCardPreview({
  option,
}: {
  option: MurphContactAvatarOption;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <MurphContactAvatarArt
        className="size-24 text-[96px] ring-1 ring-border"
        option={option}
      />
      <div className="flex flex-col items-center gap-0.5">
        <p className="font-serif text-2xl font-semibold tracking-normal text-foreground">
          Murph
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Contact card
        </p>
      </div>
    </div>
  );
}

export function MurphAddToContactsButton({
  size = "lg",
  variant = "outline",
}: {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size={size} type="button" variant={variant}>
        Add Murph to Contacts
      </Button>
      <MurphContactCardPicker
        onAddToContacts={() => setOpen(false)}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  );
}

const PICKER_TITLE = "Add Murph to your contacts";
const PICKER_DESCRIPTION =
  "Pick the photo Murph shows up with in your contacts. Same Murph either way.";
export const IN_APP_BROWSER_PRIMARY_ACTION = "Open in Safari to add Murph";
export const IN_APP_BROWSER_DESCRIPTION =
  "You're in an in-app browser, which can't save contacts. This opens Safari instead.";
const MURPH_CONTACT_CARD_HANDOFF_TIMEOUT_MS = 10_000;
// Long enough that a host "Open in Safari?" confirmation can still be tapped
// before the attempt is treated as never launched.
export const MURPH_CONTACT_CARD_LAUNCH_TIMEOUT_MS = 5_000;
const DEFAULT_PICKER_COPY = {
  description: PICKER_DESCRIPTION,
  primaryAction: "Add Murph to Contacts",
  secondaryAction: "Skip for now",
  title: PICKER_TITLE,
};

export type MurphContactCardPickerCopy = Partial<typeof DEFAULT_PICKER_COPY>;

export function MurphContactCardPicker({
  copy,
  initialAvatarId = DEFAULT_MURPH_CONTACT_AVATAR_ID,
  onAddToContacts,
  onOpenChange,
  onSkip,
  open,
}: {
  copy?: MurphContactCardPickerCopy;
  initialAvatarId?: string;
  onAddToContacts: (option: MurphContactAvatarOption) => void;
  onOpenChange: (open: boolean) => void;
  onSkip?: () => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();
  const userAgent = useSyncExternalStore(
    subscribeToBrowserSnapshot,
    readBrowserUserAgentSnapshot,
    readBrowserServerSnapshot,
  );
  const [selectedId, setSelectedId] = useState(initialAvatarId);
  const [handoffStatus, setHandoffStatus] = useState<"error" | "pending" | null>(null);
  const handoffController = useRef<AbortController | null>(null);
  const selected = findMurphContactAvatarOption(selectedId);
  const browser = detectInAppBrowser(userAgent);
  const opensInSafari = browser.inAppBrowser && browser.isIos;
  const pickerCopy = { ...DEFAULT_PICKER_COPY, ...copy };

  function handleOpenChange(nextOpen: boolean) {
    const controller = handoffController.current;
    if (!nextOpen && controller) {
      handoffController.current = null;
      controller.abort();
      setHandoffStatus("error");
      return;
    }
    onOpenChange(nextOpen);
  }

  function failHandoff(controller: AbortController) {
    // Aborting settles any launch wait so its listeners cannot outlive the attempt.
    controller.abort();
    if (handoffController.current !== controller) return;
    handoffController.current = null;
    setHandoffStatus("error");
  }

  async function handleSafariHandoff() {
    if (handoffController.current) return;
    const controller = new AbortController();
    handoffController.current = controller;
    setHandoffStatus("pending");
    const issuanceDeadline = setTimeout(
      () => controller.abort(),
      MURPH_CONTACT_CARD_HANDOFF_TIMEOUT_MS,
    );

    let claim: string;
    try {
      claim = await issueMurphContactCardHandoff(selected.id, controller.signal);
    } catch {
      failHandoff(controller);
      return;
    } finally {
      clearTimeout(issuanceDeadline);
    }

    // `assign` returns void whether or not the host accepted the scheme
    // navigation, so completion waits for this document to actually go away.
    const launched = waitForMurphContactCardLaunch(controller.signal);
    try {
      window.location.assign(
        `x-safari-https://${window.location.host}/api/murph-contact-card?handoff=${encodeURIComponent(claim)}`,
      );
    } catch {
      failHandoff(controller);
      return;
    }
    if (!(await launched)) {
      failHandoff(controller);
      return;
    }

    if (handoffController.current !== controller) return;
    handoffController.current = null;
    setHandoffStatus(null);
    onAddToContacts(selected);
  }

  const actions = (
    <div className="flex flex-col gap-2">
      {opensInSafari ? (
        <>
          <Button
            className="w-full"
            disabled={handoffStatus === "pending"}
            onClick={() => void handleSafariHandoff()}
            size="xl"
            type="button"
          >
            <ContactRoundIcon data-icon="inline-start" />
            {handoffStatus === "pending" ? "Opening Safari…" : IN_APP_BROWSER_PRIMARY_ACTION}
          </Button>
          <p className="px-2 text-center text-xs leading-5 text-muted-foreground">
            {IN_APP_BROWSER_DESCRIPTION}
          </p>
          {handoffStatus === "error" ? (
            <p
              className="px-2 text-center text-sm leading-5 text-destructive"
              role="alert"
            >
              Couldn't open Safari. Check your connection and try again.
            </p>
          ) : null}
        </>
      ) : (
        /* Keep the vCard inline so iOS opens its contact preview instead of Files. */
        <a
          className={buttonVariants({ className: "w-full", size: "xl" })}
          href={murphContactCardDownloadHref(selected.id)}
          onClick={() => onAddToContacts(selected)}
        >
          <ContactRoundIcon data-icon="inline-start" />
          {pickerCopy.primaryAction}
        </a>
      )}
      <Button
        className="w-full"
        disabled={handoffStatus === "pending"}
        onClick={() => {
          onSkip?.();
          handleOpenChange(false);
        }}
        size="xl"
        type="button"
        variant="ghost"
      >
        {pickerCopy.secondaryAction}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer onOpenChange={handleOpenChange} open={open}>
        <DrawerContent className="h-dvh data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none">
          <DrawerHeader className="items-center text-center">
            <DrawerTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {pickerCopy.title}
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6 text-muted-foreground">
              {pickerCopy.description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
            <div className="flex flex-col gap-6">
              <MurphContactCardPreview option={selected} />
              <MurphContactAvatarGrid disabled={handoffStatus === "pending"} onChange={setSelectedId} value={selectedId} />
            </div>
          </div>
          <DrawerFooter className="border-t border-border px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3">
            {actions}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-xl gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
        showCloseButton={false}
      >
        <DialogHeader className="items-center gap-2 text-center">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
            {pickerCopy.title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            {pickerCopy.description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <MurphContactCardPreview option={selected} />
          <div className="-mx-1 max-h-[42dvh] overflow-y-auto px-1 py-1">
            <MurphContactAvatarGrid disabled={handoffStatus === "pending"} onChange={setSelectedId} value={selectedId} />
          </div>
          {actions}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Resolves true only once this document goes away, which is the sole
 * observable acknowledgement that the host accepted the Safari scheme
 * navigation. A suppressed or declined launch resolves false instead.
 */
function waitForMurphContactCardLaunch(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let deadline: ReturnType<typeof setTimeout>;

    function settle(launched: boolean) {
      clearTimeout(deadline);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      signal.removeEventListener("abort", onAbort);
      resolve(launched);
    }

    function onPageHide() {
      settle(true);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") settle(true);
    }

    function onAbort() {
      settle(false);
    }

    deadline = setTimeout(() => settle(false), MURPH_CONTACT_CARD_LAUNCH_TIMEOUT_MS);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    signal.addEventListener("abort", onAbort);
  });
}

async function issueMurphContactCardHandoff(avatarId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/murph-contact-card", {
    body: JSON.stringify({ avatar: avatarId }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new Error("Murph contact-card handoff issuance failed.");
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.claim !== "string" || !payload.claim) {
    throw new Error("Murph contact-card handoff response was invalid.");
  }

  if (signal.aborted) {
    throw new Error("Murph contact-card handoff was cancelled.");
  }

  return payload.claim;
}
