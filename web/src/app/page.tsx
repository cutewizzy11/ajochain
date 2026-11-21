import Link from "next/link";

const steps = [
  {
    t: "Start a circle",
    d: "Pick the contribution (e.g. 20 USDC), how many members, and how often — weekly or monthly.",
  },
  {
    t: "Everyone contributes",
    d: "Each round, members pay into the smart contract — not into anyone's pocket. An AI agent can pay for you within a cap you set.",
  },
  {
    t: "Pot pays out automatically",
    d: "Once the round is fully paid, the contract sends the whole pot to that round's member. No collector, no excuses.",
  },
  {
    t: "Build your reputation",
    d: "Every on-time payment is recorded on-chain — a credit history that follows you to the next circle.",
  },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="text-center space-y-6 pt-8">
        <p className="text-sm font-medium text-emerald-600">Ajo · Esusu · Susu — now trustless</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Rotating savings,
          <br /> without the collector risk.
        </h1>
        <p className="max-w-2xl mx-auto opacity-80">
          Millions of Nigerians and Ghanaians save through ajo. Too many have lost money when the
          collector disappears. AjoChain puts the pot in a Soroban smart contract on Stellar that
          pays out on schedule, in stable USDC, to the right person — every time.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/app" className="btn">
            Open the app
          </Link>
          <a href="#how" className="btn-ghost">
            How it works
          </a>
        </div>
      </section>

      <section id="how" className="grid sm:grid-cols-2 gap-4">
        {steps.map((s, i) => (
          <div key={s.t} className="card">
            <div className="text-emerald-600 font-mono text-sm">0{i + 1}</div>
            <h3 className="font-semibold mt-1">{s.t}</h3>
            <p className="text-sm opacity-80 mt-2">{s.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
