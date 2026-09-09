"use client";
import { CONTRACT_ADDRESS, GENLAYER_STUDIONET } from "./config";

declare global { interface Window { ethereum?: any } }

const STUDIONET_HEX = "0x" + GENLAYER_STUDIONET.chainId.toString(16);

export async function getConnectedWalletAddress(): Promise<`0x${string}`> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found. Please install/enable MetaMask, Rabby, or a compatible wallet.");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts?.[0];
  if (!account) throw new Error("No wallet account connected.");
  return account as `0x${string}`;
}

async function ensureStudionetChain() {
  if (!window.ethereum) return;
  let currentId: string | undefined;
  try { currentId = await window.ethereum.request({ method: "eth_chainId" }); } catch {}
  if (currentId?.toLowerCase() === STUDIONET_HEX.toLowerCase()) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_HEX }],
    });
  } catch (e: any) {
    if (e?.code === 4902 || /unrecognized chain/i.test(e?.message || "")) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: STUDIONET_HEX,
          chainName: GENLAYER_STUDIONET.name,
          nativeCurrency: { name: GENLAYER_STUDIONET.currency, symbol: GENLAYER_STUDIONET.currency, decimals: 18 },
          rpcUrls: [GENLAYER_STUDIONET.rpcUrl],
          blockExplorerUrls: [GENLAYER_STUDIONET.explorerUrl],
        }],
      });
    } else { throw e; }
  }
}

export async function getGenLayerWriteClient(): Promise<{ client: any; account: `0x${string}` }> {
  const account = await getConnectedWalletAddress();
  await ensureStudionetChain();
  const { createClient } = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  const client = createClient({ chain: studionet, account } as any);
  return { client, account };
}

export async function getGenLayerReadClient(): Promise<any> {
  const { createClient } = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  return createClient({ chain: studionet } as any);
}

export function requireContract(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error("NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS not set");
  return CONTRACT_ADDRESS as `0x${string}`;
}

export type WriteResult = { hash: `0x${string}`; explorerUrl: string; receipt?: any };

/** Normalises the consensus status, which arrives as either the numeric code
 * or the enum string depending on the endpoint. 5 = ACCEPTED, 6 =
 * UNDETERMINED, 7 = FINALIZED. */
function readConsensusStatus(receipt: any): string {
  const raw = receipt?.status ?? receipt?.transaction_status;
  const s = String(raw ?? "").toUpperCase();
  if (s === "5") return "ACCEPTED";
  if (s === "6") return "UNDETERMINED";
  if (s === "7") return "FINALIZED";
  return s;
}

export type WriteOptions = {
  /** Reads chain state and resolves true once the intended change is
   * visible. A write is only reported as successful after this passes, so
   * the UI can never claim success over state that did not commit. */
  verify?: () => Promise<boolean>;
  verifyLabel?: string;
};

/**
 * Submits a write and reports success ONLY after the consensus round was
 * ACCEPTED (or FINALIZED) and, where a check is supplied, the intended state
 * change is actually readable back.
 *
 * This is deliberately strict, because the earlier version could report
 * success three different ways over a transaction that changed nothing:
 * it swallowed a failed receipt fetch and returned as though the write had
 * landed; it inspected only the LEADER receipt's execution_result, which says
 * the leader ran fine even when validators disagreed and the round committed
 * nothing; and it exempted the consensus methods from that check entirely.
 * An UNDETERMINED round is the exact shape of that failure -- the leader
 * succeeds, the state does not move, and the user is told it worked.
 */
export async function writeAndWait(
  functionName: string,
  args: any[],
  value: bigint = BigInt(0),
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const { client } = await getGenLayerWriteClient();
  const address = requireContract();
  const raw = await client.writeContract({ address, functionName, args, value });
  const txHash = (typeof raw === "string" ? raw : raw?.hash || raw?.transaction_hash) as `0x${string}`;

  let receipt: any;
  try {
    const { TransactionStatus } = await import("genlayer-js/types");
    receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: TransactionStatus.ACCEPTED,
      retries: 120,
      interval: 3000,
    });
  } catch (e) {
    // Never swallowed: without a receipt we cannot claim the write landed.
    throw new Error(
      `Could not confirm ${functionName}: no receipt was returned before the timeout. ` +
        `The transaction may still be in consensus - check the explorer before retrying. Tx: ${txHash}`,
    );
  }

  const consensus = readConsensusStatus(receipt);
  if (consensus === "UNDETERMINED") {
    throw new Error(
      `${functionName} did not reach consensus: validators disagreed, so the round was ` +
        `UNDETERMINED and no state was committed. Nothing was charged or changed - you can ` +
        `retry it. Tx: ${txHash}`,
    );
  }
  if (consensus && consensus !== "ACCEPTED" && consensus !== "FINALIZED") {
    throw new Error(`${functionName} ended in consensus status ${consensus}, not ACCEPTED. Tx: ${txHash}`);
  }

  // The leader's own execution must also not have rolled back. This now
  // applies to every method, including the consensus ones: a fallback
  // verdict is a successful execution returning a non-decisive result, which
  // is not a rollback, so exempting them only ever hid real failures.
  const exec = receipt?.consensus_data?.leader_receipt?.[0] || receipt?.consensus_data?.leader_receipt || receipt;
  const resultCode = exec?.execution_result || exec?.result || receipt?.result || receipt?.execution_result;
  const errMsg = exec?.error_message || exec?.error || receipt?.error_message;
  if (typeof resultCode === "string" && /rollback|reverted|error/i.test(resultCode)) {
    const tail = errMsg ? ` (${errMsg})` : "";
    throw new Error(`GenLayer transaction ${functionName} rolled back${tail}. Tx: ${txHash}`);
  }

  // Finally, confirm the committed state really reflects the write. Reads can
  // briefly trail an accepted round, so this is polled rather than sampled
  // once.
  if (opts.verify) {
    let committed = false;
    for (let attempt = 0; attempt < 10 && !committed; attempt++) {
      try {
        committed = await opts.verify();
      } catch {
        committed = false;
      }
      if (!committed) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!committed) {
      throw new Error(
        `${functionName} was accepted but ${opts.verifyLabel || "the expected change"} is not ` +
          `readable on-chain yet. Reload before retrying, so you do not repeat a write that ` +
          `did land. Tx: ${txHash}`,
      );
    }
  }

  return { hash: txHash, explorerUrl: `${GENLAYER_STUDIONET.explorerUrl}/tx/${txHash}`, receipt };
}

/** Reads retry on transient transport failures.
 *
 * The Studio RPC intermittently drops a request with "Failed to fetch" -- a
 * network-layer flake, not a contract error. Without a retry a single dropped
 * read blanks out a whole section, and the page then states something false
 * with confidence ("No evidence has been submitted") rather than admitting it
 * could not load. Contract-level errors are NOT retried: those are real
 * answers and repeating them just delays the truth. */
function isTransientReadError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("unknown rpc error")
  );
}

export async function read(functionName: string, args: any[] = [], retries = 3): Promise<any> {
  const address = requireContract();
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = await getGenLayerReadClient();
      return await client.readContract({ address, functionName, args });
    } catch (e) {
      lastError = e;
      if (!isTransientReadError(e) || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}
