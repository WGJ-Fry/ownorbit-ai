import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

async function withVault(testName, files, env, run) {
  const vaultDir = await mkdtemp(path.join(tmpdir(), `lifeos-vault-${testName}-`));
  const previousEnv = {};
  const nextEnv = { LIFEOS_VAULT_DIR: vaultDir, ...env };
  for (const [key, value] of Object.entries(nextEnv)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(vaultDir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
    const vault = await import(`../server/vault.ts?case=${testName}-${Date.now()}`);
    await run(vault, vaultDir);
  } finally {
    for (const key of Object.keys(nextEnv)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    await rm(vaultDir, { recursive: true, force: true });
  }
}

test("vault context reads mounted Markdown notes for forgotten-item prompts", async () => {
  await withVault("markdown-context", {
    "demo.md": [
      "# Demo memory",
      "",
      "- Passport expires in 47 days.",
      "- Project proposal for Tom is due tomorrow.",
      "- Tax filing deadline is in 12 days.",
    ].join("\n"),
    "nested/todo.md": "- Call Ada about contract renewal next Friday.",
    ".hidden.md": "secret hidden note should not appear",
    "ignored.txt": "text file should not appear",
  }, {}, async ({ loadVaultMarkdownContext }) => {
    const context = loadVaultMarkdownContext();
    assert.match(context, /<markdown_file path="demo\.md">/);
    assert.match(context, /Passport expires in 47 days/);
    assert.match(context, /Project proposal for Tom is due tomorrow/);
    assert.match(context, /Tax filing deadline is in 12 days/);
    assert.match(context, /<markdown_file path="nested\/todo\.md">/);
    assert.match(context, /contract renewal next Friday/);
    assert.doesNotMatch(context, /hidden note/);
    assert.doesNotMatch(context, /text file/);
  });
});

test("vault context obeys file and character limits", async () => {
  await withVault("limits", {
    "a.md": "a".repeat(80),
    "b.md": "b".repeat(80),
  }, {
    LIFEOS_VAULT_MAX_FILES: "1",
    LIFEOS_VAULT_MAX_CHARS_PER_FILE: "10",
    LIFEOS_VAULT_MAX_TOTAL_CHARS: "80",
  }, async ({ loadVaultMarkdownContext }) => {
    const context = loadVaultMarkdownContext();
    const fileCount = (context.match(/<markdown_file/g) || []).length;
    assert.equal(fileCount, 1);
    assert.equal(context.includes("a".repeat(11)) || context.includes("b".repeat(11)), false);
    assert.equal(context.length <= 80, true);
  });
});
