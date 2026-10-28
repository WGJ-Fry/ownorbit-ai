// "queued" means a deliverable offline-queue entry that will flush to the core
// later. "unsaved" means the message reached neither: its queue entry is only a
// failure record (e.g. an oversized photo) or the enqueue itself failed.
export type PersistOutcome = "stored" | "queued" | "unsaved";

// The core orders chat history by arrival time, so messages that belong
// together (a question and its reply) are sent one after the other. Once one
// lands as a deliverable queue entry, the rest queue behind it: the queue
// flushes in order, so a later message can never reach the core first.
// An "unsaved" message never flushes on its own, so the rest are sent online
// instead — queueing them could evict its failure record without protecting
// any order. A failure at any step must never lose the messages after it.
export async function persistInOrder<T>(
  items: T[],
  persist: (item: T) => Promise<PersistOutcome>,
  enqueue: (item: T) => Promise<void> | void,
) {
  let queueRest = false;
  for (const item of items) {
    if (queueRest) {
      try {
        await enqueue(item);
        continue;
      } catch {
        // Storing it out of order beats losing it.
      }
    }
    let outcome: PersistOutcome;
    try {
      outcome = await persist(item);
    } catch {
      outcome = "unsaved";
    }
    if (outcome === "queued") queueRest = true;
  }
}
