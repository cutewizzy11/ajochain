import Link from "next/link";

const steps = [
  {
    t: "Start a circle",
    d: "Pick the contribution (for example 20 USDC), the number of members and how often to pay: daily, weekly or monthly.",
  },
  {
    t: "Everyone contributes",
    d: "Each round, members pay into the smart contract, not into anyone's pocket. An auto-pay agent can pay for you, up to a limit you set.",
  },
  {
    t: "The pot pays out automatically",
    d: "When everyone has paid, the contract sends the whole pot to that round's member. No collector and no excuses.",
  },
  {
    t: "Build your reputation",
    d: "Every on-time payment is recorded on-chain. It becomes a savings history that follows you to your next circle.",
  },
];

const trust = [
  { t: "No collector", d: "The contract holds the pot" },
  { t: "Paid by code", d: "Payouts happen on their own" },
  { t: "Stable USDC", d: "Safe from naira and cedi swings" },
  { t: "On-chain reputation", d: "Your track record, portable" },
];

const why = [
  { t: "Fractions of a cent", d: "Stellar fees are tiny, so a 5,000-naira contribution isn't eaten by gas." },
  { t: "Final in ~5 seconds", d: "Payments settle fast. The pot lands while the circle is still on the call." },
  { t: "Native USDC", d: "Circle-issued USDC on Stellar, with cash on and off ramps across West Africa." },
  { t: "Wallets people use", d: "Works with Freighter, LOBSTR, xBull and other Stellar wallets." },
];

const MEMBERS = ["Ada", "Kofi", "Tunde", "Ama", "Chidi", "Esi"];

function PotRing() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
        <circle cx="100" cy="100" r="78" fill="none" stroke="var(--line)" strokeWidth="2" />
        <circle
          cx="100"
          cy="100"
          r="78"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.5"
          strokeDasharray="6 8"
          className="origin-center animate-[spin_40s_linear_infinite]"
        />
        <circle cx="100" cy="100" r="44" fill="var(--gold-soft)" />
        <circle cx="100" cy="100" r="34" fill="var(--gold)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#3d2a03]">Pot</span>
        <span className="text-xl font-bold text-[#2a1d02]">600 USDC</span>
      </div>
      {MEMBERS.map((name, i) => {
        const a = (i / MEMBERS.length) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + Math.cos(a) * 39;
        const y = 50 + Math.sin(a) * 39;
        const current = i === 2;
        return (
          <div
            key={name}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div
              className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-md ${
                current ? "bg-gold ring-4 ring-gold/25" : "bg-brand"
              }`}
            >
              {name[0]}
            </div>
            <div className="mt-1 text-[11px] font-medium text-muted">{current ? `${name} · gets pot` : name}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <div className="space-y-24">
      <section className="grid items-center gap-12 pt-4 md:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Ajo · Esusu · Susu, now trustless
          </span>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Rotating savings,
            <br />
            <span className="text-brand">without the collector risk.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Millions of people in Nigeria and Ghana save through ajo, and too many have lost money when the
            collector disappears. AjoChain keeps the pot in a smart contract on Stellar. It pays out on
            schedule, in stable USDC, to the right person, every time.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/app" className="btn btn-lg">
              Open the app →
            </Link>
            <a href="#how" className="btn-ghost btn-lg">
              How it works
            </a>
          </div>
        </div>
        <div className="weave rounded-3xl p-6">
          <PotRing />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
        {trust.map((t) => (
          <div key={t.t} className="bg-surface p-5">
            <div className="font-semibold">{t.t}</div>
            <div className="mt-1 text-sm text-muted">{t.d}</div>
          </div>
        ))}
      </section>

      <section id="how" className="scroll-mt-24 space-y-8">
        <div className="space-y-2">
          <p className="eyebrow">How it works</p>
          <h2 className="text-3xl font-bold tracking-tight">The ajo you know, minus the trust problem.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.t} className="card relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft font-mono text-sm font-bold text-brand">
                {i + 1}
              </div>
              <h3 className="mt-4 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <p className="eyebrow">Why Stellar</p>
          <h2 className="text-3xl font-bold tracking-tight">Built for small, frequent payments.</h2>
          <p className="text-muted">
            Ajo contributions are small and regular. They only work on-chain when fees are close to zero and
            the money is stable.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {why.map((w) => (
            <div key={w.t} className="card">
              <h3 className="font-semibold">{w.t}</h3>
              <p className="mt-1.5 text-sm text-muted">{w.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="weave relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Start your first circle in a minute.</h2>
        <p className="mx-auto mt-3 max-w-lg text-muted">
          Connect a Stellar testnet wallet, set the amount and invite your people with a link.
        </p>
        <Link href="/app" className="btn btn-lg mt-6">
          Open the app →
        </Link>
      </section>
    </div>
  );
}
