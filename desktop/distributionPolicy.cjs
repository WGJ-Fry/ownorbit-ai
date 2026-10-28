function parseMacCodeSignatureDistribution(details) {
  const value = String(details || "");
  if (!value.trim()) return "unsigned";
  if (/\bSignature=adhoc\b/i.test(value) || /\bTeamIdentifier=not set\b/i.test(value)) {
    return "unsigned";
  }
  if (/\bAuthority=Developer ID Application:/i.test(value) && /\bTeamIdentifier=[A-Z0-9]+\b/.test(value)) {
    return "signed";
  }
  return "unsigned";
}

function resolveDesktopDistribution(options = {}) {
  if (options.platform !== "darwin") return "";
  const configured = String(options.configured || "").trim().toLowerCase();
  if (!options.isPackaged && (configured === "signed" || configured === "unsigned")) return configured;
  if (!options.isPackaged) return "unsigned";
  return parseMacCodeSignatureDistribution(options.macCodeSignature);
}

module.exports = {
  parseMacCodeSignatureDistribution,
  resolveDesktopDistribution,
};
