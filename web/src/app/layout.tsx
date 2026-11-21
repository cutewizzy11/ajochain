import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AjoChain — trustless rotating savings on Stellar",
  description:
    "Ajo/Esusu savings circles where a Soroban smart contract holds the pot and pays out automatically. No collector to run away with the money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <Suspense fallback={<div className="h-16 border-b border-line" />}>
            <Nav />
          </Suspense>
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-10">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted sm:flex-row">
              <span>AjoChain · trustless ajo, esusu &amp; susu</span>
              <span>Built on Stellar Soroban · Testnet</span>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
