"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { Avatar, Logo, short } from "@/components/ui";

export { short };

export function Nav() {
  const { address, connect, disconnect } = useWallet();
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Logo />
          <span>
            Ajo<span className="text-brand">Chain</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm sm:gap-4">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Testnet
          </span>
          <Link
            href="/app"
            className={`rounded-lg px-2 py-1 font-medium transition hover:text-brand ${
              path === "/app" ? "text-brand" : "text-muted"
            }`}
          >
            My circles
          </Link>
          {address ? (
            <button onClick={disconnect} className="btn-ghost py-1.5 pl-1.5 pr-3" title="Disconnect wallet">
              <Avatar address={address} size={24} />
              <span className="font-mono text-xs">{short(address)}</span>
            </button>
          ) : (
            <button onClick={connect} className="btn py-2">
              Connect wallet
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
