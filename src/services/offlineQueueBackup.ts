import { sanitizeOfflineMessageError, type OfflineMessageQueueSummary, type OfflineQueuedMessage } from "./offlineMessageQueue";

function messageText(item: OfflineQueuedMessage) {
  const text = item.message.parts.map((part) => part.text).filter(Boolean).join("\n\n");
  return text || JSON.stringify(item.message);
}

function sourceText(item: OfflineQueuedMessage) {
  if (!item.source) return "";
  const device = item.source.deviceName || item.source.deviceIdHint || "unknown device";
  const network = item.source.networkQuality || "unknown network";
  const path = item.source.path || "-";
  return `Source: ${item.source.client} / ${device} / ${network} / ${path}`;
}

export function buildOfflineQueueBackupText(summary: OfflineMessageQueueSummary, items: OfflineQueuedMessage[], now = Date.now()) {
  const lines = [
    "OwnOrbit AI offline queue backup",
    `Created at: ${new Date(now).toISOString()}`,
    `Total: ${summary.count}`,
    `Pending: ${summary.pending}`,
    `Syncing: ${summary.syncing}`,
    `Failed: ${summary.failed}`,
    `Conflict-risk duplicates: ${summary.conflicts || 0}`,
    summary.lastError ? `Last error: ${sanitizeOfflineMessageError(summary.lastError)}` : "",
    summary.nextRetryAt ? `Next retry: ${new Date(summary.nextRetryAt).toISOString()}` : "",
    "",
    "Messages:",
  ].filter(Boolean);

  if (!items.length) lines.push("- Queue is empty.");
  for (const [index, item] of items.entries()) {
    lines.push(
      "",
      `#${index + 1} ${item.status.toUpperCase()} · attempts=${item.attempts}`,
      `Queued at: ${new Date(item.queuedAt).toISOString()}`,
      `Sync identity: mutation=${item.mutationId || "-"} idempotency=${item.idempotencyKey || "-"} sequence=${item.clientSequence || 0} sourceVersion=${item.sourceVersion || 1} stage=${item.syncStage || item.status}`,
      sourceText(item),
      item.lastAttemptAt ? `Last attempt: ${new Date(item.lastAttemptAt).toISOString()}` : "",
      item.lastError ? `Failure reason: ${sanitizeOfflineMessageError(item.lastError)}` : "",
      "Content:",
      messageText(item),
    );
  }
  return lines.filter(Boolean).join("\n");
}
