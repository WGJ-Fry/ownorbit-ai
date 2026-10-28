import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_DRAFT_STORAGE_KEY,
  MAX_CHAT_DRAFT_TEXT_LENGTH,
  emptyChatDraft,
  loadStoredChatDraft,
  parseStoredChatDraft,
  persistStoredChatDraft,
} from "../src/services/chatDraftStorage.ts";

test("chat draft storage restores text and a bounded image", () => {
  const draft = parseStoredChatDraft(JSON.stringify({
    text: "send after reconnect",
    attachedImage: "data:image/png;base64,YWJj",
  }));
  assert.deepEqual(draft, {
    text: "send after reconnect",
    attachedImage: "data:image/png;base64,YWJj",
  });
});

test("chat draft storage rejects malformed and oversized fields", () => {
  assert.deepEqual(parseStoredChatDraft("{bad"), emptyChatDraft);
  assert.equal(parseStoredChatDraft(JSON.stringify({ text: "x".repeat(MAX_CHAT_DRAFT_TEXT_LENGTH + 10) })).text.length, MAX_CHAT_DRAFT_TEXT_LENGTH);
  assert.equal(parseStoredChatDraft(JSON.stringify({ attachedImage: "javascript:alert(1)" })).attachedImage, null);
  assert.equal(parseStoredChatDraft(JSON.stringify({ attachedImage: `data:image/png;base64,${"a".repeat(2_750_001)}` })).attachedImage, null);
});

test("chat draft storage persists drafts and removes an empty draft", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(persistStoredChatDraft({ text: "hello", attachedImage: null }, storage).ok, true);
  assert.equal(loadStoredChatDraft(storage).text, "hello");
  assert.equal(values.has(CHAT_DRAFT_STORAGE_KEY), true);
  assert.equal(persistStoredChatDraft(emptyChatDraft, storage).ok, true);
  assert.equal(values.has(CHAT_DRAFT_STORAGE_KEY), false);
});

test("chat draft storage tolerates blocked browser storage", () => {
  assert.deepEqual(loadStoredChatDraft({ getItem() { throw new Error("blocked"); } }), emptyChatDraft);
  const result = persistStoredChatDraft({ text: "hello", attachedImage: null }, {
    setItem() { throw new Error("quota"); },
    removeItem() {},
  });
  assert.equal(result.ok, false);
});
