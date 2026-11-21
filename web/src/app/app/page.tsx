"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, fromUnits, Reputation, toUnits } from "@/lib/ajo";
import { AJO_CONTRACT_ID, TOKEN_CONTRACT_ID, TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Alert, Avatar, Logo, Progress, ScoreRing, StatusBadge, short } from "@/components/ui";

const PERIODS = [
  { label: "Every 5 minutes (demo)", short: "every 5 min", secs: 300 },
  { label: "Daily", short: "every day", secs: 86_400 },
  { label: "Weekly", short: "every week", secs: 604_800 },
  { label: "Monthly (30 days)", short: "every month", secs: 2_592_000 },
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
      <div className="weave mx-auto max-w-md rounded-3xl border border-line bg-surface px-6 py-12 text-center">
        <div className="mx-auto w-fit">
          <Logo size={56} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Connect to see your circles</h1>
        <p className="mt-2 text-sm text-muted">
          Use Freighter, LOBSTR, xBull or any Stellar wallet set to testnet.
        </p>
        <button className="btn btn-lg mt-6" onClick={connect}>
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
    <div className="space-y-10">
      <section className="flex flex-wrap items-center gap-4">
        <Avatar address={address} size={52} />
        <div>
          <p className="text-sm text-muted">Welcome back</p>
          <h1 className="font-mono text-xl font-bold">{short(address)}</h1>
        </div>
      </section>

      {msg && <Alert tone="error">{msg}</Alert>}

      <section className="card flex flex-col items-center gap-6 sm:flex-row">
        <ScoreRing score={score} />
        <div className="flex-1 text-center sm:text-left">
          <p className="eyebrow">Savings reputation</p>
          <p className="mt-1 text-sm text-muted">
            {score === null
              ? "Make your first contribution to start your on-chain track record."
              : score >= 80
                ? "Reliable saver. Circles can see you pay on time."
                : "Keep paying on time to raise your score."}
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:w-auto">
          <Stat label="On time" value={rep ? rep.on_time : "—"} />
          <Stat label="Late" value={rep ? rep.late : "—"} />
          <Stat label="Completed" value={rep ? rep.circles_completed : "—"} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-bold tracking-tight">My circles</h2>
          {circles.length > 0 && <span className="text-sm text-muted">{circles.length} total</span>}
        </div>
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="card h-36 animate-pulse bg-surface-2" />
            ))}
          </div>
        ) : circles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
            No circles yet. Start one below, or join with an invite.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {circles.map((c) => (
              <CircleCard key={c.id} c={c} me={address} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <form
          className="card space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const id = await ajo.createCircle(address, sign, TOKEN_CONTRACT_ID, toUnits(amount), members, period);
              router.push(`/circle/${id}`);
            });
          }}
        >
          <div>
            <h3 className="text-lg font-semibold">Start a circle</h3>
            <p className="text-sm text-muted">You become member #1 and receive the first pot.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Contribution per round ({TOKEN_SYMBOL})</label>
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="label">Members (2–50)</label>
              <input
                className="input"
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PERIODS.map((p) => (
                <button
                  type="button"
                  key={p.secs}
                  onClick={() => setPeriod(p.secs)}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    period === p.secs
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-line bg-bg text-muted hover:border-brand/40"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gold-soft px-4 py-3">
            <span className="text-sm">Each pot</span>
            <span className="font-bold tabular-nums">
              {potPreview.toLocaleString()} {TOKEN_SYMBOL}{" "}
              <span className="text-sm font-normal text-muted">{cadence}</span>
            </span>
          </div>
          <button className="btn w-full" disabled={busy || !TOKEN_CONTRACT_ID}>
            {busy ? "Waiting for wallet…" : "Create circle"}
          </button>
        </form>

        <form
          className="card flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await ajo.join(address, sign, Number(joinId));
              router.push(`/circle/${joinId}`);
            });
          }}
        >
          <div>
            <h3 className="text-lg font-semibold">Join a circle</h3>
            <p className="text-sm text-muted">Got an invite? Enter the circle number, or just open the invite link.</p>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">#</span>
            <input
              className="input pl-7 font-mono"
              placeholder="12"
              inputMode="numeric"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <button className="btn-ghost mt-auto w-full" disabled={busy || joinId === ""}>
            Join circle
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-surface px-4 py-3 text-center">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function CircleCard({ c, me }: { c: Circle; me: string }) {
  const open = c.status === "Open";
  const myTurn = c.status === "Active" && c.members[c.round] === me;
  return (
    <Link
      href={`/circle/${c.id}`}
      className="card group block transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted">Circle #{c.id}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">
            {fromUnits(c.amount * BigInt(c.max_members))}{" "}
            <span className="text-sm font-semibold text-muted">{TOKEN_SYMBOL} pot</span>
          </p>
        </div>
        <StatusBadge status={c.status} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-2">
          {c.members.slice(0, 6).map((m) => (
            <span key={m} className="rounded-full ring-2 ring-surface">
              <Avatar address={m} size={28} />
            </span>
          ))}
          {c.members.length > 6 && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold ring-2 ring-surface">
              +{c.members.length - 6}
            </span>
          )}
        </div>
        <span className="text-xs text-muted">
          {fromUnits(c.amount)} {TOKEN_SYMBOL} each
        </span>
      </div>
      <div className="mt-4 space-y-1.5">
        <Progress
          value={open ? c.members.length : c.status === "Completed" ? c.max_members : c.round}
          max={c.max_members}
          tone={open ? "gold" : "brand"}
        />
        <div className="flex justify-between text-xs text-muted">
          <span>
            {open
              ? `${c.members.length}/${c.max_members} joined`
              : c.status === "Completed"
                ? "All pots paid"
                : `Round ${Math.min(c.round + 1, c.max_members)} of ${c.max_members}`}
          </span>
          {myTurn && <span className="font-semibold text-gold">Your pot this round</span>}
        </div>
      </div>
    </Link>
  );
}
