/** wei-like u256 -> human GEN string. Amounts are ALWAYS denominated in GEN;
 * the interface never shows raw wei, which is an implementation detail of the
 * chain rather than a unit a reader thinks in.
 *
 * Formatted from the bigint directly rather than via Number, because GEN's
 * 18-decimal amounts routinely exceed Number.MAX_SAFE_INTEGER and a float
 * round-trip silently loses precision on exactly the large balances that
 * matter most. Sub-display-precision dust renders as "< 0.000001 GEN" rather
 * than rounding down to a misleading "0 GEN". */
export function formatGen(amountWei: bigint): string {
  if (amountWei === 0n) return "0 GEN";

  const negative = amountWei < 0n;
  const value = negative ? -amountWei : amountWei;
  const sign = negative ? "-" : "";

  const whole = value / 10n ** 18n;
  const frac = value % 10n ** 18n;

  const DISPLAY_DECIMALS = 6;
  let fracStr = frac.toString().padStart(18, "0").slice(0, DISPLAY_DECIMALS).replace(/0+$/, "");

  if (whole === 0n && fracStr === "") {
    // Non-zero, but smaller than the displayed precision.
    return `${sign}< 0.000001 GEN`;
  }

  const wholeStr = whole.toLocaleString("en-US");
  return `${sign}${fracStr ? `${wholeStr}.${fracStr}` : wholeStr} GEN`;
}

export function parseGenToWei(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  try {
    return BigInt(whole) * 10n ** 18n + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

/** Themis stores times as epoch seconds, not ISO strings. */
export function formatEpoch(seconds: number): string {
  if (!seconds) return "-";
  try {
    return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(seconds);
  }
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function formatSeconds(total: number): string {
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}
