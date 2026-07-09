import type express from "express";
import { insertAuditLog } from "../audit";
import { requireActor } from "../auth";
import { noteCloudKitLocalChange } from "../cloudKitAutoSyncSchedule";
import { getMemories, insertMemory, softDeleteMemory, updateMemory } from "../memories";
import { broadcastRealtime } from "../realtime";

export function registerMemoryRoutes(app: express.Express) {
  app.get("/api/v1/memories", requireActor, (_req, res) => {
    res.json({ memories: getMemories() });
  });

  app.post("/api/v1/memories", requireActor, (req, res) => {
    const { title, content, sensitivity } = req.body || {};
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: "title and content are required" });
    }

    const memory = insertMemory(title, content, sensitivity === "sensitive" ? "sensitive" : "normal");
    noteCloudKitLocalChange("memory", { type: (req as any).actor?.type || "actor", id: (req as any).actor?.id || "unknown" });
    insertAuditLog("memory_created", "memory", memory.id, { title: memory.title });
    broadcastRealtime({ type: "memory.created", memory, timestamp: memory.createdAt });
    res.json({ memory });
  });

  app.patch("/api/v1/memories/:memoryId", requireActor, (req, res) => {
    const memory = updateMemory(req.params.memoryId, req.body || {});
    if (!memory) return res.status(404).json({ error: "Memory not found" });

    insertAuditLog("memory_updated", "memory", memory.id, { title: memory.title });
    noteCloudKitLocalChange("memory", { type: (req as any).actor?.type || "actor", id: (req as any).actor?.id || "unknown" });
    broadcastRealtime({ type: "memory.updated", memory, timestamp: memory.updatedAt });
    res.json({ memory });
  });

  app.delete("/api/v1/memories/:memoryId", requireActor, (req, res) => {
    const memory = softDeleteMemory(req.params.memoryId);
    if (!memory) return res.status(404).json({ error: "Memory not found" });

    insertAuditLog("memory_deleted", "memory", memory.id, { title: memory.title });
    noteCloudKitLocalChange("memory", { type: (req as any).actor?.type || "actor", id: (req as any).actor?.id || "unknown" });
    broadcastRealtime({ type: "memory.deleted", memoryId: memory.id, timestamp: memory.deletedAt });
    res.json({ ok: true });
  });
}
