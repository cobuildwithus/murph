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

interface AuthContextValue {
  authenticated: boolean;
  openAuthDialog: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  openAuthDialog: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children?: ReactNode;
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
    <AuthContext.Provider value={value}>
      {children}
      {!authenticated ? (
        <AuthDialog
          open={open}
          onOpenChange={setOpen}
          requireLaunchConsentOnCompletion
        />
      ) : null}
    </AuthContext.Provider>
  );
}
