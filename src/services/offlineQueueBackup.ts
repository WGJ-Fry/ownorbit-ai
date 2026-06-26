import { sanitizeOfflineMessageError, type OfflineMessageQueueSummary, type OfflineQueuedMessage } from "./offlineMessageQueue";

function messageText(item: OfflineQueuedMessage) {
  const text = item.message.parts.map((part) => part.text).filter(Boolean).join("\n\n");
  return text || JSON.stringify(item.message);
}

export function buildOfflineQueueBackupText(summary: OfflineMessageQueueSummary, items: OfflineQueuedMessage[], now = Date.now()) {
  const lines = [
    "LifeOS AI offline queue backup",
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
      item.lastAttemptAt ? `Last attempt: ${new Date(item.lastAttemptAt).toISOString()}` : "",
      item.lastError ? `Failure reason: ${sanitizeOfflineMessageError(item.lastError)}` : "",
      "Content:",
      messageText(item),
    );
  }
  return lines.filter(Boolean).join("\n");
}
