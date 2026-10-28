export type PhonePairingCandidate = {
  mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
  baseUrl: string;
  secure: boolean;
};

export function candidateSupportsPhonePairing(candidate: PhonePairingCandidate) {
  if (candidate.mode === "local") return false;
  try {
    const parsed = new URL(candidate.baseUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) return false;
    if (candidate.mode !== "lan" && (parsed.protocol !== "https:" || !candidate.secure)) return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function eligiblePhonePairingCandidates<T extends PhonePairingCandidate>(candidates: T[]) {
  return candidates.filter(candidateSupportsPhonePairing);
}
