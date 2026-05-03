"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";

interface AuthDialogContextValue {
  authenticated: boolean;
  openAuthDialog: () => void;
}

const AuthDialogContext = createContext<AuthDialogContextValue>({
  authenticated: false,
  openAuthDialog: () => {},
});

export function useAuthDialog() {
  return useContext(AuthDialogContext);
}

export function AuthDialogProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const openAuthDialog = useCallback(() => {
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({ authenticated, openAuthDialog }),
    [authenticated, openAuthDialog],
  );

  return (
    <AuthDialogContext.Provider value={value}>
      {children}
      {!authenticated ? (
        <AuthDialog
          open={open}
          onOpenChange={setOpen}
          requireLaunchConsentOnCompletion
        />
      ) : null}
    </AuthDialogContext.Provider>
  );
}
