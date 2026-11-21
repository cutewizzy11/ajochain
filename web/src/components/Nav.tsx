"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function Nav() {
  const { address, connect, disconnect } = useWallet();
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">
          Ajo<span className="text-emerald-600">Chain</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/app" className="hover:underline">
            My circles
          </Link>
          {address ? (
            <button onClick={disconnect} className="btn-ghost font-mono" title="Disconnect">
              {short(address)}
            </button>
          ) : (
            <button onClick={connect} className="btn">
              Connect wallet
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
