import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
          <Nav />
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">{children}</main>
          <footer className="text-center text-xs opacity-60 py-6">
            AjoChain · built on Stellar Soroban · testnet
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
