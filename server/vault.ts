import fs from "fs";
import path from "path";

const VAULT_DIR = path.resolve(process.env.LIFEOS_VAULT_DIR || "/app/vault");
const MAX_FILES = Number(process.env.LIFEOS_VAULT_MAX_FILES || 30);
const MAX_CHARS_PER_FILE = Number(process.env.LIFEOS_VAULT_MAX_CHARS_PER_FILE || 3000);
const MAX_TOTAL_CHARS = Number(process.env.LIFEOS_VAULT_MAX_TOTAL_CHARS || 60000);

function collectMarkdownFiles(dir: string, acc: string[] = []): string[] {
  if (acc.length >= MAX_FILES) return acc;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (acc.length >= MAX_FILES) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = path.resolve(dir, entry.name);
    if (!fullPath.startsWith(VAULT_DIR)) continue;

    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, acc);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      acc.push(fullPath);
    }
  }

  return acc;
}

export function loadVaultMarkdownContext(): string {
  if (!fs.existsSync(VAULT_DIR)) return "";

  const files = collectMarkdownFiles(VAULT_DIR).slice(0, MAX_FILES);
  let total = 0;
  const chunks: string[] = [];

  for (const filePath of files) {
    if (total >= MAX_TOTAL_CHARS) break;

    try {
      const relativePath = path.relative(VAULT_DIR, filePath);
      const raw = fs.readFileSync(filePath, "utf8");
      const content = raw.slice(0, MAX_CHARS_PER_FILE);
      total += content.length;
      chunks.push(`<markdown_file path="${relativePath}">\n${content}\n</markdown_file>`);
    } catch {
      continue;
    }
  }

  return chunks.join("\n\n---\n\n").slice(0, MAX_TOTAL_CHARS);
}
