import { act, createElement, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

import { DeviceSyncCompletionDialog } from "../app/(dashboard)/home/device-sync-completion-dialog";
import type { DeviceSyncCompletionDialogModel } from "@/src/lib/device-sync/connect-completion-types";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    size,
    variant,
    ...props
  }: HTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  }) => {
    void size;
    void variant;
    return createElement("button", props, children);
  },
  buttonVariants: ({ className }: { className?: string } = {}) => className ?? "",
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
  }) => (open ? createElement("div", { "data-dialog": "open" }, children) : null),
  DialogContent: (props: HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
    showCloseButton?: boolean;
  }) => {
    const { children, showCloseButton, ...rest } = props;
    void showCloseButton;
    return createElement("div", rest, children);
  },
  DialogDescription: ({
    children,
    ...props
  }: HTMLAttributes<HTMLParagraphElement> & { children?: ReactNode }) =>
    createElement("p", props, children),
  DialogHeader: ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) =>
    createElement("div", props, children),
  DialogTitle: ({
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) =>
    createElement("h2", props, children),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

test("DeviceSyncCompletionDialog refreshes an unverified completion once before stripping params", async () => {
  // Vitest gives this file its own module graph, so the dialog module's
  // retry guard starts fresh here and is shared across the remount below.
  const unverifiedModel = buildCompletionDialogModel({ unverified: true });
  const firstRender = await renderDeviceSyncCompletionDialog(unverifiedModel);
  await act(async () => {});

  expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  expect(firstRender.replaceState).not.toHaveBeenCalled();

  await firstRender.cleanup();

  const remount = await renderDeviceSyncCompletionDialog(unverifiedModel);
  await act(async () => {});

  expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  expect(remount.replaceState).toHaveBeenCalledWith(
    {},
    "",
    "/home?keep=1#source",
  );

  await remount.cleanup();
});

function buildCompletionDialogModel(
  overrides: Partial<DeviceSyncCompletionDialogModel> = {},
): DeviceSyncCompletionDialogModel {
  return {
    contactAction: null,
    detail: "Open Murph to confirm your connected sources.",
    failed: false,
    kind: "device-sync",
    retryHref: null,
    title: "Device connection complete",
    unverified: false,
    ...overrides,
  };
}

async function renderDeviceSyncCompletionDialog(
  model: DeviceSyncCompletionDialogModel,
) {
  return renderClientComponent(
    createElement(DeviceSyncCompletionDialog, { model }),
    {
      location: {
        hash: "#source",
        href: "https://app.example.test/home?deviceSyncCompletion=1&deviceSyncStatus=connected&deviceSyncProvider=whoop&keep=1#source",
        pathname: "/home",
        search: "?deviceSyncCompletion=1&deviceSyncStatus=connected&deviceSyncProvider=whoop&keep=1",
      },
    },
  );
}
