"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, fromUnits, Reputation, toUnits } from "@/lib/ajo";
import { AJO_CONTRACT_ID, TOKEN_CONTRACT_ID, TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Alert, Avatar, Logo, Progress, Score, StatusBadge, short } from "@/components/ui";

const PERIODS = [
  { label: "5 min (demo)", short: "every 5 min", secs: 300 },
  { label: "Daily", short: "every day", secs: 86_400 },
  { label: "Weekly", short: "every week", secs: 604_800 },
  { label: "Monthly", short: "every month", secs: 2_592_000 },
];

export default function Dashboard() {
  const { address, connect, sign } = useWallet();
  const router = useRouter();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [rep, setRep] = useState<Reputation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [amount, setAmount] = useState("10");
  const [members, setMembers] = useState(5);
  const [period, setPeriod] = useState(PERIODS[2].secs);
  const [joinId, setJoinId] = useState("");

  const load = useCallback(async () => {
    if (!address || !AJO_CONTRACT_ID) return;
    try {
      const ids = await ajo.circlesOf(address, address);
      setCircles(await Promise.all(ids.map((id) => ajo.getCircle(address, Number(id)))));
      setRep(await ajo.reputation(address, address));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [address]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setMsg(null);
    try {
      return await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!AJO_CONTRACT_ID) {
    return (
      <Alert tone="error">
        Contract not configured. Set <code>NEXT_PUBLIC_AJO_CONTRACT_ID</code> in <code>web/.env.local</code> after
        deploying (see README).
      </Alert>
    );
  }

  if (!address) {
    return (
      <div className="sheet ruled mx-auto max-w-md px-8 py-12">
        <Logo size={44} />
        <h1 className="display mt-6 text-3xl">Connect to see your circles</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Use Freighter, LOBSTR, xBull or any Stellar wallet set to testnet.
        </p>
        <button className="btn btn-lg mt-8" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }

  const total = rep ? rep.on_time + rep.late : 0;
  const score = total ? Math.round((rep!.on_time / total) * 100) : null;
  const amt = Number(amount);
  const potPreview = Number.isFinite(amt) && amt > 0 ? amt * members : 0;
  const cadence = PERIODS.find((p) => p.secs === period)?.short ?? "";

  return (
    <div className="space-y-14">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/70 pb-6">
        <div>
          <p className="kicker">Member ledger</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Your circles</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Avatar address={address} size={28} />
          <span className="font-mono text-sm">{short(address)}</span>
        </div>
      </header>

      {msg && <Alert tone="error">{msg}</Alert>}

      <section className="sheet grid gap-8 p-6 sm:grid-cols-[auto_1fr_auto] sm:items-end sm:p-8">
        <div>
          <p className="kicker mb-3">Savings reputation</p>
          <Score score={score} />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-ink-2">
          {score === null
            ? "Make your first contribution to start your on-chain track record."
            : score >= 80
              ? "Reliable saver. Circles can see you pay on time."
              : "Keep paying on time to raise your score."}
        </p>
        <dl className="grid grid-cols-3 border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
          <Stat label="On time" value={rep ? rep.on_time : "—"} />
          <Stat label="Late" value={rep ? rep.late : "—"} />
          <Stat label="Completed" value={rep ? rep.circles_completed : "—"} />
        </dl>
      </section>

      <section>
        <div className="flex items-baseline justify-between border-b border-ink/70 pb-2">
          <h2 className="font-display text-2xl">Circles</h2>
          {circles.length > 0 && <span className="font-mono text-[11px] text-muted">{circles.length} on record</span>}
        </div>
        {!loaded ? (
          <div className="divide-y divide-line">
            {[0, 1].map((i) => (
              <div key={i} className="py-5">
                <div className="h-14 animate-pulse rounded-[3px] bg-paper-2" />
              </div>
            ))}
          </div>
        ) : circles.length === 0 ? (
          <div className="mt-6 rounded-[4px] border border-dashed border-line px-6 py-10 text-sm text-muted">
            No circles yet. Start one below, or join with an invite.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {circles.map((c) => (
              <li key={c.id}>
                <CircleRow c={c} me={address} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <form
          className="sheet space-y-6 p-6 sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const id = await ajo.createCircle(address, sign, TOKEN_CONTRACT_ID, toUnits(amount), members, period);
              router.push(`/circle/${id}`);
            });
          }}
        >
          <div>
            <h3 className="font-display text-2xl">Start a circle</h3>
            <p className="mt-1 text-sm text-muted">You become member #1 and receive the first pot.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Contribution per round ({TOKEN_SYMBOL})</label>
              <input className="input font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="label">Members (2–50)</label>
              <input
                className="input font-mono"
                type="number"
                min={2}
                max={50}
                value={members}
                onChange={(e) => setMembers(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <label className="label">Round length</label>
            <div className="grid grid-cols-2 overflow-hidden rounded-[3px] border border-ink/70 sm:grid-cols-4">
              {PERIODS.map((p, i) => (
                <button
                  type="button"
                  key={p.secs}
                  onClick={() => setPeriod(p.secs)}
                  aria-pressed={period === p.secs}
                  className={`px-3 py-2.5 text-xs font-medium transition-colors ${
                    i > 0 ? "border-l border-ink/70" : ""
                  } ${i === 2 ? "max-sm:border-l-0 max-sm:border-t" : ""} ${i === 3 ? "max-sm:border-t" : ""} ${
                    period === p.secs ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-baseline gap-3 text-sm">
            <span className="text-ink-2">Each pot</span>
            <span className="leader" />
            <span className="figure text-xl">
              {potPreview.toLocaleString()} {TOKEN_SYMBOL}
            </span>
            <span className="font-mono text-[11px] text-muted">{cadence}</span>
          </div>
          <button className="btn w-full" disabled={busy || !TOKEN_CONTRACT_ID}>
            {busy ? "Waiting for wallet…" : "Create circle"}
          </button>
        </form>

        <form
          className="sheet flex flex-col gap-6 p-6 sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await ajo.join(address, sign, Number(joinId));
              router.push(`/circle/${joinId}`);
            });
          }}
        >
          <div>
            <h3 className="font-display text-2xl">Join a circle</h3>
            <p className="mt-1 text-sm text-muted">Got an invite? Enter the circle number, or just open the invite link.</p>
          </div>
          <div>
            <label className="label">Circle number</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted">#</span>
              <input
                className="input pl-7 font-mono"
                placeholder="12"
                inputMode="numeric"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <button className="btn-quiet mt-auto w-full" disabled={busy || joinId === ""}>
            Join circle
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="pr-6 last:pr-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="figure mt-1 text-3xl">{value}</dd>
    </div>
  );
}

function CircleRow({ c, me }: { c: Circle; me: string }) {
  const open = c.status === "Open";
  const myTurn = c.status === "Active" && c.members[c.round] === me;
  return (
    <Link
      href={`/circle/${c.id}`}
      className="group grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 py-5 transition-colors hover:bg-paper-2/60 sm:grid-cols-[6rem_1fr_12rem_auto] sm:items-center sm:px-2"
    >
      <span className="font-mono text-sm text-muted">#{String(c.id).padStart(4, "0")}</span>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
        <p className="figure text-2xl">
          {fromUnits(c.amount * BigInt(c.max_members))} <span className="font-mono text-xs text-muted">{TOKEN_SYMBOL} pot</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {fromUnits(c.amount)} {TOKEN_SYMBOL} × {c.max_members} members
          {myTurn && <span className="ml-2 font-medium text-stamp">Your pot this round</span>}
        </p>
      </div>
      <div className="col-span-2 row-start-3 space-y-1.5 sm:col-span-1 sm:row-start-auto">
        <Progress
          value={open ? c.members.length : c.status === "Completed" ? c.max_members : c.round}
          max={c.max_members}
          tone={open ? "gold" : "brand"}
        />
        <p className="font-mono text-[11px] text-muted">
          {open
            ? `${c.members.length}/${c.max_members} joined`
            : c.status === "Completed"
              ? "All pots paid"
              : `Round ${Math.min(c.round + 1, c.max_members)} of ${c.max_members}`}
        </p>
      </div>
      <div className="col-start-2 row-start-1 flex items-center gap-3 justify-self-end sm:col-start-auto sm:row-start-auto">
        <StatusBadge status={c.status} />
        <span className="hidden text-muted transition-transform group-hover:translate-x-0.5 sm:inline">→</span>
      </div>
    </Link>
  );
}
