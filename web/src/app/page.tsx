import Link from "next/link";
import type { CSSProperties } from "react";
import { Passbook, type Cell } from "@/components/ui";
import { Reveal } from "@/components/motion";

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const CIRCLES = ["Ajo", "Esusu", "Susu", "Adashi", "Tontine", "Chama", "Stokvel", "Njangi", "Paluwagan", "Tanda", "Hui", "Kye", "Partner hand"];

const steps = [
  {
    title: "Start a circle",
    body: "Pick the contribution (for example 20 USDC), the number of members and how often to pay: daily, weekly or monthly.",
  },
  {
    title: "Everyone contributes",
    body: "Each round, members pay into the smart contract, not into anyone's pocket. An auto-pay agent can pay for you, up to a limit you set.",
  },
  {
    title: "The pot pays out automatically",
    body: "When everyone has paid, the contract sends the whole pot to that round's member. No collector and no excuses.",
  },
  {
    title: "Build your reputation",
    body: "Every on-time payment is recorded on-chain. It becomes a savings history that follows you to your next circle.",
  },
];

const NAMES = ["Ada", "Kofi", "Tunde", "Ama", "Chidi", "Esi"];
const PAID_NOW = new Set([0, 1, 3, 5]);

const cells: Cell[][] = NAMES.map((_, i) =>
  Array.from({ length: 6 }, (_, r): Cell => {
    if (r < 2) return { state: i === r ? "pot" : "paid" };
    if (r === 2) return { state: PAID_NOW.has(i) ? "paid" : "due", turn: i === 2 };
    return { state: "empty" };
  }),
);

const facts = [
  { figure: "0.00001 XLM", label: "Base network fee per payment" },
  { figure: "~5s", label: "For a contribution to settle" },
  { figure: "USDC", label: "Dollar savings, issued by Circle" },
  { figure: "₦ in · ₦ out", label: "Top up from and cash out to your bank via a licensed Stellar anchor (SEP-24). The pot never leaves the contract." },
  { figure: "Freighter · LOBSTR · xBull", label: "Wallets people already use" },
];

export default function Home() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div>
          <p className="kicker fade-up" style={d(0)}>Esusu · Ajo · Susu — on Stellar</p>
          <h1 className="display mt-5 text-5xl leading-[1.02] sm:text-6xl lg:text-[4.25rem]">
            <span className="sr-only">Ajo, without anybody holding the money.</span>
            <span aria-hidden>
              {["Ajo, without", "anybody holding", "the money."].map((line, i) => (
                <span key={line} className="line-mask block">
                  <span style={d(120 + i * 110)}>
                    {i === 2 ? (
                      <>
                        the <em className="ink-underline not-italic">money.</em>
                      </>
                    ) : (
                      line
                    )}
                  </span>
                </span>
              ))}
            </span>
          </h1>
          <p className="fade-up mt-6 max-w-lg text-lg leading-relaxed text-ink-2" style={d(520)}>
            You pay in 20 USDC on Friday. When everyone has paid, a contract on Stellar sends the pot to whoever&apos;s
            turn it is. There is no collector to trust, chase or lose.
          </p>
          <div className="fade-up mt-9 flex flex-wrap gap-3" style={d(640)}>
            <Link href="/app" className="btn btn-lg">
              Open the app <span className="nudge">→</span>
            </Link>
            <a href="#how" className="btn-quiet btn-lg">
              How it works
            </a>
          </div>
        </div>

        <figure className="sheet lift fade-up p-5 sm:p-6" style={d(260)}>
          <div className="mb-4 flex items-baseline justify-between border-b border-line pb-3">
            <span className="font-display text-lg">Contribution card</span>
            <span className="font-mono text-[11px] text-muted">CIRCLE #0412 · WEEKLY</span>
          </div>
          <Passbook
            rows={NAMES.map((n) => ({ key: n, label: <span className="text-sm">{n}</span> }))}
            rounds={6}
            current={2}
            cells={cells}
          />
          <figcaption className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-muted">
            Round 3 of 6. Tunde&apos;s pot is 600 USDC; four of six have paid.
          </figcaption>
        </figure>
      </section>

      <div className="marquee -mx-5 border-y border-line py-4 sm:-mx-8" aria-label="Rotating savings circles around the world">
        <div className="marquee-track">
          {[0, 1].map((k) => (
            <span key={k} aria-hidden={k === 1} className="flex shrink-0 items-center">
              {CIRCLES.map((c) => (
                <span key={c} className="flex items-center font-display text-2xl text-ink-2">
                  <span className="px-6 italic">{c}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-stamp" />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <section id="how" className="scroll-mt-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <Reveal>
            <p className="kicker">The method</p>
            <h2 className="display mt-3 text-4xl">How a round works</h2>
          </Reveal>
          <ol className="border-t border-ink/70">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90} className="grid grid-cols-[3rem_1fr] gap-4 border-b border-line py-6">
                <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="font-display text-xl">{s.title}</h3>
                  <p className="mt-1.5 max-w-xl leading-relaxed text-ink-2">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section>
        <p className="kicker">Why Stellar</p>
        <dl className="mt-6 grid border-t border-ink/70 sm:grid-cols-2 lg:grid-cols-5">
          {facts.map((f, i) => (
            <Reveal key={f.label} delay={i * 90} className="border-b border-line py-6 sm:pr-6 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:[&:not(:first-child)]:pl-6">
              <dt className="figure text-2xl">{f.figure}</dt>
              <dd className="mt-2 text-sm text-muted">{f.label}</dd>
            </Reveal>
          ))}
        </dl>
      </section>

      <Reveal as="section" className="flex flex-col items-start justify-between gap-6 border-y border-ink/70 py-10 sm:flex-row sm:items-center">
        <h2 className="display max-w-xl text-3xl sm:text-4xl">Start a circle with people you already save with.</h2>
        <Link href="/app" className="btn btn-lg">
          Open the app <span className="nudge">→</span>
        </Link>
      </Reveal>
    </div>
  );
}
