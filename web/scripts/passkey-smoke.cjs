// End-to-end passkey smoke test against testnet via a running Next server.
// Usage: npm run dev -- -p 3123 && BASE=http://localhost:3123 npm run smoke   (DEBUG=1 for event dumps)
// A Node P-256 key stands in for the authenticator; the assertion format is identical.

const crypto = require("crypto");
const S = require("@stellar/stellar-sdk");
const { Account, Address, authorizeEntry, Operation, rpc, TransactionBuilder, nativeToScVal, scValToNative, xdr } = S;

const BASE = process.env.BASE || "http://localhost:3123";
const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing ${k} (run via npm run smoke)`); return v; };
const PASS = env("NEXT_PUBLIC_NETWORK_PASSPHRASE");
const AJO = env("NEXT_PUBLIC_AJO_CONTRACT_ID");
const TOKEN = env("NEXT_PUBLIC_TOKEN_CONTRACT_ID");
const RELAYER = env("NEXT_PUBLIC_RELAYER_ADDRESS");
const server = new rpc.Server(env("NEXT_PUBLIC_RPC_URL"));
const b64u = (b) => Buffer.from(b).toString("base64url");
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function fakePasskey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pub: spki.subarray(-65), credentialId: b64u(crypto.randomBytes(32)) };
}

function assert(pk, payload) {
  const authData = Buffer.concat([crypto.createHash("sha256").update(new URL(BASE).hostname).digest(), Buffer.from([0x05, 0, 0, 0, 1])]);
  const cdj = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: b64u(payload), origin: new URL(BASE).origin }));
  const msg = Buffer.concat([authData, crypto.createHash("sha256").update(cdj).digest()]);
  const raw = crypto.sign("sha256", msg, { key: pk.privateKey, dsaEncoding: "ieee-p1363" });
  let s = BigInt("0x" + raw.subarray(32).toString("hex"));
  if (s > N / 2n) s = N - s;
  const sig = Buffer.concat([raw.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, "0"), "hex")]);
  const e = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: xdr.ScVal.scvBytes(v) });
  return xdr.ScVal.scvMap([e("authenticator_data", authData), e("client_data_json", cdj), e("signature", sig)]);
}

const build = (op) =>
  new TransactionBuilder(new Account(RELAYER, "0"), { fee: "100", networkPassphrase: PASS }).addOperation(op).setTimeout(30).build();

async function write(pk, me, method, args) {
  const call = (auth = []) => Operation.invokeContractFunction({ contract: AJO, function: method, args, auth });
  const first = await server.simulateTransaction(build(call()));
  if (rpc.Api.isSimulationError(first)) throw new Error(first.error);
  const until = first.latestLedger + 120;
  const auth = await Promise.all(first.result.auth.map((en) => {
    const c = en.credentials;
    const ac = c.type === "sorobanCredentialsAddress" ? c.address : c.type === "sorobanCredentialsAddressV2" ? c.addressV2 : null;
    if (!ac || Address.fromScAddress(ac.address).toString() !== me) return en;
    return authorizeEntry(en, async (_p, payload) => ({ signatureScVal: assert(pk, payload) }), until, PASS);
  }));
  const draft = build(call(auth));
  const second = await server.simulateTransaction(draft);
  if (rpc.Api.isSimulationError(second)) {
    if (process.env.DEBUG) console.log(JSON.stringify(S.humanizeEvents(second.events ?? []), (k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
    throw new Error("resim: " + second.error);
  }
  const prepared = rpc.assembleTransaction(draft, second).build();
  const r = await fetch(BASE + "/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ xdr: prepared.toXDR() }) });
  const body = await r.json();
  if (!r.ok) throw new Error(`relay ${r.status}: ${body.error}`);
  return body.returnValue ? scValToNative(xdr.ScVal.fromXDR(body.returnValue, "base64")) : undefined;
}

async function newWallet() {
  const pk = fakePasskey();
  const r = await fetch(BASE + "/api/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentialId: pk.credentialId, publicKey: b64u(pk.pub) }) });
  const body = await r.json();
  if (!r.ok) throw new Error(`wallet ${r.status}: ${body.error}`);
  return { pk, addr: body.address };
}

const a = (s) => new Address(s).toScVal();
const u32 = (n) => nativeToScVal(n, { type: "u32" });

(async () => {
  let t = Date.now();
  const lap = (m) => { console.log(`${m} (${((Date.now() - t) / 1000).toFixed(1)}s)`); t = Date.now(); };
  const A = await newWallet(); lap("wallet A " + A.addr);
  const B = await newWallet(); lap("wallet B " + B.addr);
  const id = await write(A.pk, A.addr, "create_circle", [a(A.addr), a(TOKEN), nativeToScVal(10_000_000n, { type: "i128" }), u32(2), nativeToScVal(86400n, { type: "u64" })]);
  lap("create_circle -> id " + id);
  await write(B.pk, B.addr, "join", [u32(id), a(B.addr)]); lap("B joined");
  await write(A.pk, A.addr, "contribute", [u32(id), a(A.addr)]); lap("A contributed");
  await write(B.pk, B.addr, "contribute", [u32(id), a(B.addr)]); lap("B contributed");
  // Negative: B's passkey must not be able to act for A.
  try { await write(B.pk, A.addr, "contribute", [u32(id), a(A.addr)]); console.log("NEGATIVE TEST FAILED: forged auth accepted"); }
  catch (e) { console.log("forged auth rejected ✓:", String(e.message).slice(0, 80)); }
  console.log("ALL OK");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
