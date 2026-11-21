"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, fromUnits, Reputation, toUnits } from "@/lib/ajo";
import { AJO_CONTRACT_ID, TOKEN_CONTRACT_ID, TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

const PERIODS = [
  { label: "Every 5 minutes (demo)", secs: 300 },
  { label: "Daily", secs: 86_400 },
  { label: "Weekly", secs: 604_800 },
  { label: "Monthly (30 days)", secs: 2_592_000 },
];

export default function Dashboard() {
  const { address, connect, sign } = useWallet();
  const router = useRouter();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [rep, setRep] = useState<Reputation | null>(null);
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
      <div className="card">
        Contract not configured. Set <code>NEXT_PUBLIC_AJO_CONTRACT_ID</code> in{" "}
        <code>web/.env.local</code> after deploying (see README).
      </div>
    );
  }

  if (!address) {
    return (
      <div className="card text-center space-y-4">
        <p>Connect a Stellar wallet (testnet) to see your circles.</p>
        <button className="btn" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }

  const total = rep ? rep.on_time + rep.late : 0;
  const score = total ? Math.round((rep!.on_time / total) * 100) : null;

  return (
    <div className="space-y-8">
      {msg && <div className="card border-red-500/50 text-red-600 text-sm">{msg}</div>}

      <section className="grid sm:grid-cols-3 gap-4">
        <Stat label="Reliability score" value={score === null ? "—" : `${score}%`} />
        <Stat label="On-time payments" value={rep ? String(rep.on_time) : "—"} />
        <Stat label="Circles completed" value={rep ? String(rep.circles_completed) : "—"} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">My circles</h2>
        {circles.length === 0 && <p className="opacity-70 text-sm">No circles yet — start or join one below.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          {circles.map((c) => (
            <Link key={c.id} href={`/circle/${c.id}`} className="card hover:border-emerald-500">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Circle #{c.id}</span>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-sm opacity-80 mt-2">
                {fromUnits(c.amount)} {TOKEN_SYMBOL} × {c.max_members} members · pot{" "}
                {fromUnits(c.amount * BigInt(c.max_members))} {TOKEN_SYMBOL}
              </p>
              <p className="text-xs opacity-60 mt-1">
                {c.status === "Open"
                  ? `${c.members.length}/${c.max_members} joined`
                  : `Round ${Math.min(c.round + 1, c.max_members)} of ${c.max_members}`}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const id = await ajo.createCircle(address, sign, TOKEN_CONTRACT_ID, toUnits(amount), members, period);
              router.push(`/circle/${id}`);
            });
          }}
        >
          <h3 className="font-semibold">Start a circle</h3>
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
          <div>
            <label className="label">Round length</label>
            <select className="input" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => (
                <option key={p.secs} value={p.secs}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn w-full" disabled={busy || !TOKEN_CONTRACT_ID}>
            {busy ? "Waiting for wallet…" : "Create circle"}
          </button>
        </form>

        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await ajo.join(address, sign, Number(joinId));
              router.push(`/circle/${joinId}`);
            });
          }}
        >
          <h3 className="font-semibold">Join a circle</h3>
          <p className="text-sm opacity-70">Got an invite? Enter the circle number.</p>
          <input className="input" placeholder="Circle #" value={joinId} onChange={(e) => setJoinId(e.target.value)} />
          <button className="btn w-full" disabled={busy || joinId === ""}>
            Join
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: Circle["status"] }) {
  const color =
    status === "Active" ? "bg-emerald-600" : status === "Open" ? "bg-amber-500" : "bg-zinc-500";
  return <span className={`text-xs text-white rounded-full px-2 py-0.5 ${color}`}>{status}</span>;
}
