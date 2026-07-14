import type { NetworkDiagnostics } from "./lifeosApi";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];

export function buildConnectionSetupPacket(candidate: ConnectionCandidate, now = Date.now()) {
  const lines = [
    "OwnOrbit AI remote connection setup",
    `Generated: ${new Date(now).toISOString()}`,
    "",
    `Label: ${candidate.label}`,
    `Mode: ${candidate.mode}`,
    `Base URL: ${candidate.baseUrl}`,
    `Mobile chat URL: ${candidate.mobileChatUrl}`,
    `Stability: ${candidate.stability}`,
    `Secure: ${candidate.secure ? "yes" : "no"}`,
    `Requires restart: ${candidate.requiresRestart ? "yes" : "no"}`,
    "",
    "Startup env:",
    candidate.envTemplate || "-",
    "",
    "Restart instruction:",
    candidate.restartInstruction || "-",
    "",
    "Next steps:",
    "1. Save this entry as the desktop startup config in OwnOrbit AI.",
    "2. Restart the desktop app if the entry says it requires restart.",
    "3. Generate a fresh phone pairing QR code after the entry is saved.",
    "4. Run the remote health check and pair the phone with this entry.",
  ];
  if (candidate.notes.length) {
    lines.push("", "Notes:", ...candidate.notes.map((note) => `- ${note}`));
  }
  return lines.join("\n");
}
