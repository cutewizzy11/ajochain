"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NETWORK_PASSPHRASE } from "./config";
import type { SignFn, Signer } from "./ajo";
import { loadPasskey, loginPasskey, passkeysSupported, registerPasskey, savePasskey } from "./passkey";
import { RELAYER_ADDRESS, PASSKEY_WASM_HASH } from "./passkey-address";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;
export type WalletKind = "passkey" | "wallet";

interface WalletState {
  address: string | null;
  kind: WalletKind | null;
  /** What the ajo write functions need to authorise a call. */
  signer: Signer | null;
  /** Opens the sign-in chooser (passkey or Stellar wallet). */
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Classic-wallet transaction signing (anchor flows). Throws for passkey users. */
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
const passkeysEnabled = () => !!RELAYER_ADDRESS && !!PASSKEY_WASM_HASH && passkeysSupported();

type Session = { kind: "passkey"; address: string; credentialId: string } | { kind: "wallet"; address: string };

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [chooser, setChooser] = useState(false);

  useEffect(() => {
    const pk = loadPasskey();
    if (pk) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession({ kind: "passkey", ...pk });
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSession({ kind: "wallet", address: saved });
    } catch {}
  }, []);

  const connect = useCallback(() => setChooser(true), []);

  const connectWallet = useCallback(async () => {
    const kit = await getKit();
    const { address } = await kit.authModal();
    savePasskey(null);
    setSession({ kind: "wallet", address });
    try {
      localStorage.setItem(STORAGE_KEY, address);
    } catch {}
  }, []);

  const connectPasskey = useCallback(async (mode: "create" | "login", name: string) => {
    const w = mode === "create" ? await registerPasskey(name) : await loginPasskey();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setSession({ kind: "passkey", ...w });
  }, []);

  const disconnect = useCallback(async () => {
    if (session?.kind === "wallet") {
      const kit = await getKit();
      await kit.disconnect().catch(() => {});
    }
    savePasskey(null);
    setSession(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [session]);

  const address = session?.address ?? null;

  const sign = useCallback<SignFn>(
    async (xdr) => {
      if (session?.kind !== "wallet") throw new Error("This action needs a Stellar wallet (Freighter, xBull, …)");
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: session.address,
      });
      return signedTxXdr;
    },
    [session],
  );

  const signer = useMemo<Signer | null>(() => {
    if (!session) return null;
    return session.kind === "passkey"
      ? { kind: "passkey", credentialId: session.credentialId }
      : { kind: "wallet", signTx: sign };
  }, [session, sign]);

  return (
    <WalletContext.Provider value={{ address, kind: session?.kind ?? null, signer, connect, disconnect, sign }}>
      {children}
      {chooser && (
        <ConnectChooser
          onClose={() => setChooser(false)}
          onPasskey={connectPasskey}
          onWallet={connectWallet}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

// ----- sign-in chooser -------------------------------------------------------

function ConnectChooser({
  onClose,
  onPasskey,
  onWallet,
}: {
  onClose: () => void;
  onPasskey: (mode: "create" | "login", name: string) => Promise<void>;
  onWallet: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "create" | "login" | "wallet">(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(passkeysEnabled());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = async (which: "create" | "login" | "wallet") => {
    setBusy(which);
    setError(null);
    try {
      if (which === "wallet") {
        onClose(); // the kit opens its own modal
        await onWallet();
        return;
      }
      await onPasskey(which, name.trim() || "AjoChain member");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // NotAllowedError = user dismissed the OS prompt.
      setError(/NotAllowed|cancel/i.test(msg) ? "Cancelled — try again when you're ready." : msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        className="sheet w-full max-w-md p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="kicker">Sign in</p>
            <h2 id="connect-title" className="display mt-1 text-2xl">
              Join the circle
            </h2>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {enabled ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-ink-2">
              Use Face ID, your fingerprint or phone PIN. No seed phrase, no app to install, and we cover the
              network fees.
            </p>
            <label className="label mt-4" htmlFor="pk-name">
              Your name (shown on your passkey)
            </label>
            <input
              id="pk-name"
              className="input"
              placeholder="e.g. Ada Obi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <button className="btn btn-lg w-full" disabled={!!busy} onClick={() => go("create")}>
              {busy === "create" ? "Creating your wallet…" : "Create a passkey wallet"}
            </button>
            <button className="btn-quiet w-full" disabled={!!busy} onClick={() => go("login")}>
              {busy === "login" ? "Waiting for your passkey…" : "I already have one — sign in"}
            </button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-ink-2">Passkey sign-in isn’t available in this browser.</p>
        )}

        {error && <p className="mt-3 break-words text-sm text-stamp">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="kicker">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <button className="btn-quiet mt-4 w-full" disabled={!!busy} onClick={() => go("wallet")}>
          Use a Stellar wallet (Freighter, xBull, …)
        </button>
      </div>
    </div>
  );
}
