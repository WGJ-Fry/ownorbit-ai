import assert from "node:assert/strict";
import test from "node:test";
import { persistInOrder } from "../src/services/orderedMessagePersistence.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the reply is not sent until the question has been stored", async () => {
  const events = [];
  const questionStored = deferred();
  const persist = async (item) => {
    events.push(`start:${item}`);
    if (item === "question") await questionStored.promise;
    events.push(`done:${item}`);
    return "stored";
  };

  const run = persistInOrder(["question", "reply"], persist, () => {
    throw new Error("nothing should be queued");
  });
  // A slow question upload (e.g. a large photo) must hold the reply back.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["start:question"]);

  questionStored.resolve();
  await run;
  assert.deepEqual(events, ["start:question", "done:question", "start:reply", "done:reply"]);
});

test("once the question falls back to the offline queue, the reply is queued behind it", async () => {
  const persisted = [];
  const queued = [];
  await persistInOrder(
    ["question", "reply"],
    async (item) => {
      persisted.push(item);
      return item === "question" ? "queued" : "stored";
    },
    async (item) => {
      queued.push(item);
    },
  );
  // Sending the reply online here would store it ahead of the queued question.
  assert.deepEqual(persisted, ["question"]);
  assert.deepEqual(queued, ["reply"]);
});

test("a later fallback does not retroactively queue already stored messages", async () => {
  const queued = [];
  await persistInOrder(
    ["first", "second", "third"],
    async (item) => (item === "second" ? "queued" : "stored"),
    (item) => {
      queued.push(item);
    },
  );
  assert.deepEqual(queued, ["third"]);
});

test("a question kept only as a failure record does not pull the reply into the queue", async () => {
  const persisted = [];
  const queued = [];
  await persistInOrder(
    ["photo-question", "reply"],
    async (item) => {
      persisted.push(item);
      return item === "photo-question" ? "unsaved" : "stored";
    },
    (item) => {
      queued.push(item);
    },
  );
  // Queueing the reply would evict the failure record and order nothing.
  assert.deepEqual(persisted, ["photo-question", "reply"]);
  assert.deepEqual(queued, []);
});

test("a question whose save throws does not take the reply down with it", async () => {
  const persisted = [];
  await persistInOrder(
    ["question", "reply"],
    async (item) => {
      if (item === "question") throw new Error("QuotaExceededError");
      persisted.push(item);
      return "stored";
    },
    () => {
      throw new Error("nothing should be queued");
    },
  );
  assert.deepEqual(persisted, ["reply"]);
});

test("if queueing behind the question fails, the reply is still sent", async () => {
  const persisted = [];
  await persistInOrder(
    ["question", "reply"],
    async (item) => {
      persisted.push(item);
      return item === "question" ? "queued" : "stored";
    },
    () => {
      throw new Error("storage full");
    },
  );
  assert.deepEqual(persisted, ["question", "reply"]);
});
