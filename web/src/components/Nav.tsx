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
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-xl tracking-[-0.01em]">AjoChain</span>
        </Link>
        <nav className="flex items-center gap-5">
          <span className="kicker hidden sm:inline">Testnet</span>
          <Link
            href="/app"
            className={`text-sm underline-offset-4 ${path === "/app" ? "underline decoration-ink" : "hover:underline"}`}
          >
            Circles
          </Link>
          {address ? (
            <button className="btn-quiet py-1.5" onClick={disconnect} title="Disconnect wallet">
              <Avatar address={address} size={20} />
              <span className="font-mono text-xs">{short(address)}</span>
            </button>
          ) : (
            <button className="btn py-2" onClick={connect}>
              Connect wallet
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
