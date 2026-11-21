"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NETWORK_PASSPHRASE } from "./config";
import type { SignFn } from "./ajo";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

interface WalletState {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sign: SignFn;
}

const WalletContext = createContext<WalletState | null>(null);

let kitPromise: Promise<Kit> | null = null;

/** Load the kit only in the browser (it touches window / custom elements). */
function getKit(): Promise<Kit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const [{ StellarWalletsKit }, { defaultModules }] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/sdk"),
        import("@creit.tech/stellar-wallets-kit/modules/utils"),
      ]);
      StellarWalletsKit.init({
        modules: defaultModules(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        network: NETWORK_PASSPHRASE as any,
      });
      return StellarWalletsKit;
    })();
  }
  return kitPromise;
}

const STORAGE_KEY = "ajochain:address";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setAddress(saved);
    } catch {}
  }, []);

  const connect = useCallback(async () => {
    const kit = await getKit();
    const { address } = await kit.authModal();
    setAddress(address);
    try {
      localStorage.setItem(STORAGE_KEY, address);
    } catch {}
  }, []);

  const disconnect = useCallback(async () => {
    const kit = await getKit();
    await kit.disconnect().catch(() => {});
    setAddress(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const sign = useCallback<SignFn>(
    async (xdr) => {
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: address ?? undefined,
      });
      return signedTxXdr;
    },
    [address],
  );

  return (
    <WalletContext.Provider value={{ address, connect, disconnect, sign }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
