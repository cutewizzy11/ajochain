"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ajo, Circle, fromUnits, Payout } from "@/lib/ajo";
import { TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Alert, Avatar, formatDuration, Logo, Progress, StatusBadge, short, useNow } from "@/components/ui";

const OK = new Set(["Joined!", "Contribution recorded ✔", "Allowance set", "Agent authorised"]);

export function CircleView() {
  const id = Number(useParams<{ id: string }>().id);
  const { address, connect, sign } = useWallet();
  const [c, setC] = useState<Circle | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [deadline, setDeadline] = useState<bigint | null>(null);
  const [agent, setAgent] = useState("");
  const [rounds, setRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [approved, setApproved] = useState(false);
  const now = useNow();

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
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!address) {
    return (
      <div className="weave mx-auto max-w-md rounded-3xl border border-line bg-surface px-6 py-12 text-center">
        <div className="mx-auto w-fit">
          <Logo size={56} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">You&apos;re invited to circle #{id}</h1>
        <p className="mt-2 text-sm text-muted">Connect a Stellar testnet wallet to view it and join.</p>
        <button className="btn btn-lg mt-6" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }

  if (!c) {
    return msg ? (
      <Alert tone="error">{msg}</Alert>
    ) : (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
        <div className="card h-48 animate-pulse bg-surface-2" />
        <div className="card h-64 animate-pulse bg-surface-2" />
      </div>
    );
  }

  const isMember = c.members.includes(address);
  const iPaid = paid.includes(address);
  const pot = c.amount * BigInt(c.max_members);
  const share = typeof window !== "undefined" ? `${window.location.origin}/circle/${id}` : "";
  const recipient = c.status === "Active" ? c.members[c.round] : null;
  const left = deadline ? Number(deadline) - now : 0;

  return (
    <div className="space-y-6">
      <Link href="/app" className="text-sm text-muted transition hover:text-brand">
        ← My circles
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Savings circle</p>
          <h1 className="text-3xl font-bold tracking-tight">Circle #{c.id}</h1>
        </div>
        <StatusBadge status={c.status} />
      </div>

      {msg && <Alert tone={OK.has(msg) ? "success" : "error"}>{msg}</Alert>}

      {/* Pot hero */}
      <section className="weave overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.3fr_1fr] sm:p-8">
          <div>
            <p className="text-sm text-muted">Pot each round</p>
            <p className="mt-1 text-5xl font-bold tracking-tight tabular-nums">
              {fromUnits(pot)} <span className="text-xl font-semibold text-muted">{TOKEN_SYMBOL}</span>
            </p>
            <p className="mt-2 text-sm text-muted">
              {fromUnits(c.amount)} {TOKEN_SYMBOL} × {c.max_members} members
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4">
            {c.status === "Active" && recipient ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar address={recipient} size={40} ring />
                  <div className="min-w-0">
                    <p className="text-xs text-muted">
                      Round {c.round + 1} of {c.max_members} · pot goes to
                    </p>
                    <p className="font-mono font-semibold">
                      {short(recipient)}
                      {recipient === address && <span className="ml-1 font-sans text-gold">(you!)</span>}
                    </p>
                  </div>
                </div>
                <Progress value={paid.length} max={c.max_members} />
                <div className="flex justify-between text-xs text-muted">
                  <span>
                    {paid.length} of {c.max_members} paid
                  </span>
                  {deadline && (
                    <span className={left <= 0 ? "font-semibold text-danger" : ""}>
                      {left <= 0 ? "Deadline passed" : `${formatDuration(left)} left`}
                    </span>
                  )}
                </div>
              </div>
            ) : c.status === "Open" ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {c.max_members - c.members.length} more to go. Starts automatically when full.
                </p>
                <Progress value={c.members.length} max={c.max_members} tone="gold" />
                <p className="text-xs text-muted">
                  {c.members.length}/{c.max_members} joined
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-center text-center">
                <p className="text-2xl">🎉</p>
                <p className="font-semibold">Circle complete</p>
                <p className="text-xs text-muted">Every member received their pot.</p>
              </div>
            )}
          </div>
        </div>

        {/* Primary action */}
        {c.status === "Open" && (
          <div className="border-t border-line bg-surface px-6 py-4 sm:px-8">
            {isMember ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="input font-mono text-xs" readOnly value={share} onFocus={(e) => e.target.select()} />
                <button
                  className="btn shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(share);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? "Copied ✔" : "Copy invite link"}
                </button>
              </div>
            ) : (
              <button
                className="btn btn-lg w-full"
                disabled={busy}
                onClick={() => run(() => ajo.join(address, sign, id), "Joined!")}
              >
                {busy ? "Waiting for wallet…" : `Join · ${fromUnits(c.amount)} ${TOKEN_SYMBOL} per round`}
              </button>
            )}
          </div>
        )}
        {c.status === "Active" && isMember && (
          <div className="border-t border-line bg-surface px-6 py-4 sm:px-8">
            <button
              className="btn btn-lg w-full"
              disabled={busy || iPaid}
              onClick={() => run(() => ajo.contribute(address, sign, id), "Contribution recorded ✔")}
            >
              {busy
                ? "Waiting for wallet…"
                : iPaid
                  ? "You've paid this round ✔"
                  : `Pay ${fromUnits(c.amount)} ${TOKEN_SYMBOL}`}
            </button>
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        {/* Payout timeline */}
        <section className="card">
          <h2 className="font-semibold">Payout order</h2>
          <p className="text-sm text-muted">Each member gets the full pot once, in this order.</p>
          <ol className="mt-4">
            {c.members.map((m, i) => {
              const payout = payouts.find((p) => p.round === i);
              const current = c.status === "Active" && i === c.round;
              const last = i === c.members.length - 1;
              return (
                <li key={m} className="relative flex gap-3 pb-4 last:pb-0">
                  {!last && <span className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-px bg-line" />}
                  <span className={`rounded-full ${current ? "ring-2 ring-gold ring-offset-2 ring-offset-surface" : ""}`}>
                    <Avatar address={m} size={34} />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">
                        {short(m)} {m === address && <span className="font-sans text-xs text-muted">(you)</span>}
                      </p>
                      <p className="text-xs text-muted">Round {i + 1}</p>
                    </div>
                    <MemberStatus
                      payout={payout}
                      current={current}
                      active={c.status === "Active"}
                      paid={paid.includes(m)}
                    />
                  </div>
                </li>
              );
            })}
            {c.status === "Open" &&
              Array.from({ length: c.max_members - c.members.length }, (_, i) => (
                <li key={`empty-${i}`} className="flex items-center gap-3 pb-4 last:pb-0">
                  <span className="h-[34px] w-[34px] rounded-full border-2 border-dashed border-line" />
                  <span className="text-sm text-muted">Open seat · round {c.members.length + i + 1}</span>
                </li>
              ))}
          </ol>
        </section>

        {/* Auto-pay agent */}
        {isMember && c.status !== "Completed" ? (
          <section className="card space-y-4 self-start">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Auto-pay agent</h2>
                <span className="rounded-full bg-indigo/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo">
                  Optional
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                Never miss a round. The agent pays for you, but only up to the allowance you set. You stay in
                control.
              </p>
            </div>

            <Step n={1} done={approved} title="Set a spending limit">
              <div className="flex items-center gap-2">
                <input
                  className="input w-20"
                  type="number"
                  min={1}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                />
                <span className="text-sm text-muted">
                  rounds = <b className="text-ink">{fromUnits(c.amount * BigInt(Math.max(0, rounds)))}</b> {TOKEN_SYMBOL}
                </span>
              </div>
              <button
                className="btn-ghost w-full"
                disabled={busy || rounds < 1}
                onClick={async () => {
                  if (await run(() => ajo.approve(address, sign, c.token, c.amount * BigInt(rounds)), "Allowance set"))
                    setApproved(true);
                }}
              >
                Approve allowance
              </button>
            </Step>

            <Step n={2} done={false} title="Authorise the agent">
              <input
                className="input font-mono text-xs"
                placeholder="G… agent address"
                value={agent}
                onChange={(e) => setAgent(e.target.value.trim())}
              />
              <button
                className="btn w-full"
                disabled={busy || !agent}
                onClick={() => run(() => ajo.setAgent(address, sign, id, agent), "Agent authorised")}
              >
                Authorise agent
              </button>
            </Step>
          </section>
        ) : (
          <section className="card space-y-2 self-start">
            <h2 className="font-semibold">How this circle works</h2>
            <ul className="space-y-2 text-sm text-muted">
              <li>• Everyone pays {fromUnits(c.amount)} {TOKEN_SYMBOL} each round into the contract.</li>
              <li>• When all have paid, the contract sends the pot to that round&apos;s member.</li>
              <li>• On-time payments build each member&apos;s on-chain reputation.</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function MemberStatus({
  payout,
  current,
  active,
  paid,
}: {
  payout?: Payout;
  current: boolean;
  active: boolean;
  paid: boolean;
}) {
  const pill = "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold";
  if (payout)
    return (
      <span className={`${pill} bg-brand-soft text-brand`}>
        Received {fromUnits(payout.amount)} {TOKEN_SYMBOL}
      </span>
    );
  if (current)
    return <span className={`${pill} bg-gold-soft text-gold`}>Receiving now{paid ? " · paid" : ""}</span>;
  if (active)
    return paid ? (
      <span className={`${pill} bg-brand-soft text-brand`}>Paid ✔</span>
    ) : (
      <span className={`${pill} bg-surface-2 text-muted`}>Pending</span>
    );
  return null;
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-brand text-white" : "bg-brand-soft text-brand"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
