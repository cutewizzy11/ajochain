"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ajo, Circle, fromUnits, Payout } from "@/lib/ajo";
import { TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { short } from "@/components/Nav";

export function CircleView() {
  const id = Number(useParams<{ id: string }>().id);
  const { address, connect, sign } = useWallet();
  const [c, setC] = useState<Circle | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [deadline, setDeadline] = useState<bigint | null>(null);
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const circle = await ajo.getCircle(address, id);
      setC(circle);
      setPayouts(await ajo.payouts(address, id));
      if (circle.status === "Active") {
        setPaid(await ajo.paidThisRound(address, id));
        setDeadline(await ajo.roundDeadline(address, id));
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, [address, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!address) {
    return (
      <div className="card text-center space-y-4">
        <p>Connect your wallet to view circle #{id}.</p>
        <button className="btn" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }
  if (!c) return <p className="opacity-70">{msg ?? "Loading…"}</p>;

  const isMember = c.members.includes(address);
  const iPaid = paid.includes(address);
  const pot = c.amount * BigInt(c.max_members);
  const share = typeof window !== "undefined" ? `${window.location.origin}/circle/${id}` : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Circle #{c.id}</h1>
        <span className="text-sm opacity-70">{c.status}</span>
      </div>

      {msg && <div className="card text-sm">{msg}</div>}

      <section className="grid sm:grid-cols-3 gap-4">
        <Info label="Contribution" value={`${fromUnits(c.amount)} ${TOKEN_SYMBOL}`} />
        <Info label="Pot per round" value={`${fromUnits(pot)} ${TOKEN_SYMBOL}`} />
        <Info
          label={c.status === "Active" ? "Round deadline" : "Round"}
          value={
            c.status === "Active" && deadline
              ? new Date(Number(deadline) * 1000).toLocaleString()
              : c.status === "Open"
                ? `${c.members.length}/${c.max_members} joined`
                : "Finished"
          }
        />
      </section>

      {c.status === "Open" && (
        <div className="card space-y-3">
          <p className="text-sm">
            Waiting for {c.max_members - c.members.length} more member(s). The circle starts automatically when full.
          </p>
          {isMember ? (
            <div className="flex gap-2">
              <input className="input font-mono" readOnly value={share} />
              <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(share)}>
                Copy invite
              </button>
            </div>
          ) : (
            <button className="btn" disabled={busy} onClick={() => run(() => ajo.join(address, sign, id), "Joined!")}>
              Join this circle
            </button>
          )}
        </div>
      )}

      {c.status === "Active" && isMember && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Round {c.round + 1} of {c.max_members}</h2>
          <p className="text-sm opacity-80">
            This round&apos;s pot goes to <span className="font-mono">{short(c.members[c.round])}</span>
            {c.members[c.round] === address && " (you!)"}.
          </p>
          <button
            className="btn"
            disabled={busy || iPaid}
            onClick={() => run(() => ajo.contribute(address, sign, id), "Contribution recorded ✔")}
          >
            {iPaid ? "You've paid this round ✔" : `Pay ${fromUnits(c.amount)} ${TOKEN_SYMBOL}`}
          </button>
        </div>
      )}

      <section className="card">
        <h2 className="font-semibold mb-3">Members &amp; payout order</h2>
        <ol className="space-y-2">
          {c.members.map((m, i) => {
            const payout = payouts.find((p) => p.round === i);
            return (
              <li key={m} className="flex justify-between text-sm">
                <span className="font-mono">
                  {i + 1}. {short(m)} {m === address && <span className="opacity-60">(you)</span>}
                </span>
                <span className="opacity-80">
                  {payout
                    ? `received ${fromUnits(payout.amount)} ${TOKEN_SYMBOL}`
                    : c.status === "Active" && i === c.round
                      ? paid.includes(m)
                        ? "receiving now · paid"
                        : "receiving now"
                      : c.status === "Active"
                        ? paid.includes(m)
                          ? "paid ✔"
                          : "pending"
                        : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {isMember && c.status !== "Completed" && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Auto-pay agent</h2>
          <p className="text-sm opacity-80">
            Authorise an AI agent address to pay your contribution on time. It can only spend what you
            allow the contract via a token allowance — you stay in control.
          </p>
          <div className="flex gap-2">
            <input className="input font-mono" placeholder="G… agent address" value={agent} onChange={(e) => setAgent(e.target.value)} />
            <button
              className="btn"
              disabled={busy || !agent}
              onClick={() => run(() => ajo.setAgent(address, sign, id, agent), "Agent authorised")}
            >
              Authorise
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs opacity-70">{label}</div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}
