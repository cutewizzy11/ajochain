import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";
import { AJO_CONTRACT_ID } from "@/lib/config";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "AjoChain — ajo without anybody holding the money",
  description:
    "Ajo/Esusu savings circles where a Soroban smart contract holds the pot and pays out automatically. No collector to run away with the money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const contract = AJO_CONTRACT_ID ? `${AJO_CONTRACT_ID.slice(0, 4)}…${AJO_CONTRACT_ID.slice(-4)}` : null;
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <WalletProvider>
          <Suspense fallback={<div className="h-[60px] border-b border-line" />}>
            <Nav />
          </Suspense>
          <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 font-mono text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <span>AjoChain — the esusu card, kept by code.</span>
              <span>
                Soroban testnet
                {contract && (
                  <>
                    {" · contract "}
                    <Link
                      className="link"
                      href={`https://stellar.expert/explorer/testnet/contract/${AJO_CONTRACT_ID}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {contract}
                    </Link>
                  </>
                )}
              </span>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
