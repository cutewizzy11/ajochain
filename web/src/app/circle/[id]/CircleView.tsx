"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ajo, Circle, fromUnits, Payout } from "@/lib/ajo";
import { TOKEN_SYMBOL } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { ANCHOR_ASSET, ANCHOR_DOMAIN, naira, rampFlow, useNgnRate } from "@/lib/anchor";
import {
  Alert,
  Avatar,
  type Cell,
  formatDuration,
  Logo,
  Passbook,
  Progress,
  StatusBadge,
  short,
  useNow,
} from "@/components/ui";
import { CountUp, Loader } from "@/components/motion";

const OK = new Set(["Joined!", "Contribution recorded", "Allowance set", "Agent authorised", "Anchor opened — finish in the popup"]);

export function CircleView() {
  const id = Number(useParams<{ id: string }>().id);
  const { address, connect, sign, signer, kind } = useWallet();
  const { rate } = useNgnRate(TOKEN_SYMBOL);
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
  const [balance, setBalance] = useState<bigint | null>(null);
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
        // Balance is a nice-to-have; a failed read shouldn't block the page.
        setBalance(await ajo.balance(address, address).catch(() => null));
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
      <div className="sheet ruled mx-auto max-w-md px-6 py-10 sm:px-8 sm:py-12">
        <Logo size={44} />
        <h1 className="display mt-6 text-3xl">You&apos;re invited to circle #{id}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">Connect a Stellar testnet wallet to view it and join.</p>
        <button className="btn btn-lg mt-8 w-full sm:w-auto" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }

  if (!c) {
    return msg ? (
      <Alert tone="error">{msg}</Alert>
    ) : (
      <Loader label="Reading the ledger" />
    );
  }

  const isMember = c.members.includes(address);
  const iPaid = paid.includes(address);
  const pot = c.amount * BigInt(c.max_members);
  const share = typeof window !== "undefined" ? `${window.location.origin}/circle/${id}` : "";
  const recipient = c.status === "Active" ? c.members[c.round] : null;
  const left = deadline ? Number(deadline) - now : 0;
  const active = c.status === "Active";
  const lowFunds = !iPaid && balance !== null && balance < c.amount;

  const seats = c.status === "Open" ? c.max_members - c.members.length : 0;
  const rows = [
    ...c.members.map((m) => ({
      key: m,
      label: (
        <span className="flex items-center gap-2">
          <Avatar address={m} size={22} />
          <span className="font-mono text-xs">{short(m)}</span>
          {m === address && <span className="text-xs text-stamp">(you)</span>}
        </span>
      ),
    })),
    ...Array.from({ length: seats }, (_, i) => ({
      key: `seat-${i}`,
      label: (
        <span className="flex items-center gap-2 text-muted">
          <span className="inline-block h-[22px] w-[22px] rounded-[3px] border border-dashed border-line" />
          <span className="text-xs">Open seat</span>
        </span>
      ),
    })),
  ];

  const cells: Cell[][] = rows.map((_, i) =>
    Array.from({ length: c.max_members }, (_, r): Cell => {
      const m = c.members[i];
      if (!m) return { state: "empty" };
      if (payouts.some((p) => p.round === r) || c.status === "Completed") return { state: i === r ? "pot" : "paid" };
      if (active && r === c.round) return { state: paid.includes(m) ? "paid" : "due", turn: i === r };
      return { state: "empty" };
    }),
  );

  const notes = rows.map((_, i) => {
    const m = c.members[i];
    if (!m) return "";
    const payout = payouts.find((p) => p.round === i);
    if (payout) return `Received ${fromUnits(payout.amount)} ${TOKEN_SYMBOL}`;
    if (active && i === c.round) return `Receiving now${paid.includes(m) ? " · paid" : ""}`;
    if (active) return paid.includes(m) ? "Paid" : "Pending";
    return "";
  });

  return (
    <div className="space-y-10">
      <Link href="/app" className="font-mono text-xs text-muted transition-colors hover:text-ink">
        ← Your circles
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/70 pb-6">
        <div>
          <p className="kicker">Savings circle</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Circle #{c.id}</h1>
        </div>
        <StatusBadge status={c.status} />
      </header>

      {msg && <Alert tone={OK.has(msg) ? "success" : "error"}>{msg}</Alert>}

      <section className="sheet">
        <div className="grid sm:grid-cols-[1.3fr_1fr]">
          <div className="p-5 sm:p-8">
            <p className="kicker">Pot each round</p>
            <p className="figure mt-3 break-words text-5xl leading-none sm:text-6xl">
              <CountUp value={Number(fromUnits(pot))} /> <span className="font-mono text-base text-muted">{TOKEN_SYMBOL}</span>
            </p>
            <p className="mt-3 font-mono text-xs text-muted">
              {fromUnits(c.amount)} {TOKEN_SYMBOL} × {c.max_members} members · ≈ {naira(Number(fromUnits(pot)) * rate)}
            </p>
          </div>

          <div className="border-t border-line p-5 sm:border-l sm:border-t-0 sm:p-8">
            {active && recipient ? (
              <div className="space-y-4">
                <p className="kicker">
                  Round {c.round + 1} of {c.max_members} · pot goes to
                </p>
                <div className="flex items-center gap-3">
                  <Avatar address={recipient} size={36} ring />
                  <p className="font-mono text-sm">
                    {short(recipient)}
                    {recipient === address && <span className="ml-1.5 font-sans text-stamp">(you)</span>}
                  </p>
                </div>
                <Progress value={paid.length} max={c.max_members} />
                <div className="flex justify-between font-mono text-[11px] text-muted">
                  <span>
                    {paid.length} of {c.max_members} paid
                  </span>
                  {deadline && (
                    <span className={left <= 0 ? "text-stamp" : ""}>
                      {left <= 0 ? "Deadline passed" : `${formatDuration(left)} left`}
                    </span>
                  )}
                </div>
              </div>
            ) : c.status === "Open" ? (
              <div className="space-y-4">
                <p className="kicker">Enrolment</p>
                <p className="text-sm">
                  {c.max_members - c.members.length} more to go. Starts automatically when full.
                </p>
                <Progress value={c.members.length} max={c.max_members} tone="gold" />
                <p className="font-mono text-[11px] text-muted">
                  {c.members.length}/{c.max_members} joined
                </p>
              </div>
            ) : (
              <div className="flex h-full items-center">
                <p className="font-display text-xl leading-snug">
                  Circle complete — every member received their pot.
                </p>
              </div>
            )}
          </div>
        </div>

        {c.status === "Open" && (
          <div className="border-t border-line bg-paper-2/50 px-4 py-4 sm:px-8">
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
                  {copied ? "Copied" : "Copy invite link"}
                </button>
              </div>
            ) : (
              <button
                className="btn btn-lg w-full"
                disabled={busy}
                onClick={() => run(() => ajo.join(address, signer!, id), "Joined!")}
              >
                {busy ? "Confirming…" : `Join · ${fromUnits(c.amount)} ${TOKEN_SYMBOL} per round`}
              </button>
            )}
          </div>
        )}
        {active && isMember && (
          <div className="border-t border-line bg-paper-2/50 px-4 py-4 sm:px-8">
            <button
              className="btn btn-lg w-full"
              disabled={busy || iPaid || lowFunds}
              onClick={() => run(() => ajo.contribute(address, signer!, id), "Contribution recorded")}
            >
              {busy ? "Confirming…" : iPaid ? "Paid this round" : lowFunds ? `Not enough ${TOKEN_SYMBOL} to pay` : `Pay ${fromUnits(c.amount)} ${TOKEN_SYMBOL} · ≈ ${naira(Number(fromUnits(c.amount)) * rate)}`}
            </button>
            {balance !== null && (
              <p className={`mt-2 font-mono text-[11px] ${lowFunds ? "text-red-600" : "text-muted"}`}>
                Your balance: {fromUnits(balance)} {TOKEN_SYMBOL}
                {lowFunds && (
                  <>
                    {" "}· you need {fromUnits(c.amount - balance)} more.{" "}
                    {kind === "wallet"
                      ? "Top up with Friendbot (testnet) or add naira below."
                      : `Send ${TOKEN_SYMBOL} to your wallet address to top up.`}
                  </>
                )}
              </p>
            )}
            {kind === "wallet" ? (
              <>
            <div className="mt-3 grid gap-2 min-[380px]:grid-cols-2">
              <button
                className="btn-quiet"
                disabled={busy}
                onClick={() => run(() => rampFlow("deposit", address, sign), "Anchor opened — finish in the popup")}
              >
                ₦ Add naira
              </button>
              <button
                className="btn-quiet"
                disabled={busy}
                onClick={() => run(() => rampFlow("withdraw", address, sign), "Anchor opened — finish in the popup")}
              >
                Cash out to bank
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
              Naira in/out via a licensed Stellar anchor ({ANCHOR_DOMAIN}, {ANCHOR_ASSET}, SEP-24). The anchor only
              converts at the edges; it never touches the pot, which only this contract can release.
            </p>
              </>
            ) : (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
                Naira on/off-ramp needs a Stellar wallet (Freighter, xBull…). Passkey wallets pay no network fees.
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="sheet min-w-0 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
            <h2 className="font-display text-xl">Contribution card</h2>
            <span className="font-mono text-[10px] text-muted sm:text-[11px]">PAYOUT ORDER = ROW ORDER</span>
          </div>
          <Passbook rows={rows} rounds={c.max_members} current={active ? c.round : null} cells={cells} end={notes} />
        </section>

        {isMember && c.status !== "Completed" ? (
          <section className="sheet min-w-0 self-start p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-xl">Auto-pay agent</h2>
              <span className="kicker">Optional</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Never miss a round. The agent pays for you, but only up to the allowance you set. You stay in control.
            </p>

            <div className="mt-5 border-t border-line">
              <Step n={1} done={approved} title="Set a spending limit">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input w-20 font-mono"
                    type="number"
                    min={1}
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value))}
                  />
                  <span className="text-sm text-muted">
                    rounds = <b className="font-medium text-ink">{fromUnits(c.amount * BigInt(Math.max(0, rounds)))}</b>{" "}
                    {TOKEN_SYMBOL}
                  </span>
                </div>
                <button
                  className="btn-quiet w-full"
                  disabled={busy || rounds < 1}
                  onClick={async () => {
                    if (await run(() => ajo.approve(address, signer!, c.token, c.amount * BigInt(rounds)), "Allowance set"))
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
                  onClick={() => run(() => ajo.setAgent(address, signer!, id, agent), "Agent authorised")}
                >
                  Authorise agent
                </button>
              </Step>
            </div>
          </section>
        ) : (
          <section className="sheet min-w-0 self-start p-5 sm:p-6">
            <h2 className="font-display text-xl">How this circle works</h2>
            <ul className="mt-3 text-sm leading-relaxed text-ink-2">
              <li className="border-t border-line py-3">
                Everyone pays {fromUnits(c.amount)} {TOKEN_SYMBOL} each round into the contract.
              </li>
              <li className="border-t border-line py-3">
                When all have paid, the contract sends the pot to that round&apos;s member.
              </li>
              <li className="border-t border-line py-3">On-time payments build each member&apos;s on-chain reputation.</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
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
    <div className="border-b border-line py-5 last:border-b-0 last:pb-0">
      <div className="mb-3 flex items-center gap-3">
        {done ? (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-label="done" className="text-indigo">
            <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="w-4 font-mono text-xs text-muted">{String(n).padStart(2, "0")}</span>
        )}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
