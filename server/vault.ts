import fs from "fs";
import path from "path";

const VAULT_DIR = path.resolve(process.env.LIFEOS_VAULT_DIR || "/app/vault");
const MAX_FILES = Number(process.env.LIFEOS_VAULT_MAX_FILES || 30);
const MAX_CHARS_PER_FILE = Number(process.env.LIFEOS_VAULT_MAX_CHARS_PER_FILE || 3000);
const MAX_TOTAL_CHARS = Number(process.env.LIFEOS_VAULT_MAX_TOTAL_CHARS || 60000);
const CALENDAR_ICS_DIR = path.resolve(process.env.LIFEOS_CALENDAR_ICS_DIR || path.join(VAULT_DIR, "calendar"));
const MAX_CALENDAR_FILES = Number(process.env.LIFEOS_CALENDAR_MAX_FILES || 10);
const MAX_CALENDAR_EVENTS = Number(process.env.LIFEOS_CALENDAR_MAX_EVENTS || 20);
const CALENDAR_LOOKAHEAD_DAYS = Number(process.env.LIFEOS_CALENDAR_LOOKAHEAD_DAYS || 90);
const MAX_MEMORY_SIGNALS = Number(process.env.LIFEOS_VAULT_MAX_SIGNALS || 40);

type MemorySignal = {
  path: string;
  line: number;
  kind: "deadline" | "todo" | "appointment" | "promise" | "renewal";
  heading?: string;
  text: string;
};

type CalendarEvent = {
  filePath: string;
  startsAt: Date;
  endsAt?: Date;
  title: string;
  location?: string;
  description?: string;
};

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function guardContentTags(value: string): string {
  return value.replace(/<\/(markdown_file|markdown_digest|memory_signal|calendar_context|calendar_event)>/gi, "<\\/$1>");
}

function compactLine(value: string, maxLength = 220): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted;
}

function collectFiles(
  root: string,
  maxFiles: number,
  predicate: (entry: fs.Dirent) => boolean,
  dir = root,
  acc: string[] = [],
): string[] {
  if (acc.length >= maxFiles) return acc;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (acc.length >= maxFiles) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = path.resolve(dir, entry.name);
    if (!isInsidePath(root, fullPath)) continue;

    if (entry.isDirectory()) {
      collectFiles(root, maxFiles, predicate, fullPath, acc);
      continue;
    }

    if (entry.isFile() && predicate(entry)) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function collectMarkdownFiles(): string[] {
  return collectFiles(VAULT_DIR, MAX_FILES, (entry) => entry.name.toLowerCase().endsWith(".md"));
}

function collectIcsFiles(): string[] {
  return collectFiles(CALENDAR_ICS_DIR, MAX_CALENDAR_FILES, (entry) => entry.name.toLowerCase().endsWith(".ics"));
}

function signalKind(line: string): MemorySignal["kind"] | null {
  if (/续费|renew|renewal|expires?|到期/i.test(line)) return "renewal";
  if (/截止|deadline|due|报税|提交|交付/i.test(line)) return "deadline";
  if (/会议|预约|appointment|meeting|call\b|电话/i.test(line)) return "appointment";
  if (/承诺|promise|follow up|跟进|答应/i.test(line)) return "promise";
  if (/\[[ xX]\]|todo|待办|提醒|记得|fixme/i.test(line)) return "todo";
  return null;
}

function extractMarkdownSignals(relativePath: string, raw: string): MemorySignal[] {
  const signals: MemorySignal[] = [];
  let heading = "";
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length && signals.length < 12; index += 1) {
    const line = compactLine(lines[index]);
    if (!line) continue;

    const headingMatch = line.match(/^#{1,3}\s+(.{1,120})$/);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }

    const kind = signalKind(line);
    if (!kind) continue;

    signals.push({
      path: relativePath,
      line: index + 1,
      kind,
      heading,
      text: line,
    });
  }

  return signals;
}

function buildMarkdownDigest(signals: MemorySignal[]): string {
  if (signals.length === 0) return "";

  const rows = signals.slice(0, MAX_MEMORY_SIGNALS).map((signal) => {
    const heading = signal.heading ? ` heading="${escapeAttribute(signal.heading)}"` : "";
    return `<memory_signal file="${escapeAttribute(signal.path)}" line="${signal.line}" kind="${signal.kind}"${heading}>${guardContentTags(signal.text)}</memory_signal>`;
  });

  return `<markdown_digest type="memory_signals" source="lifeos-vault">\n${rows.join("\n")}\n</markdown_digest>`;
}

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function readIcsProperty(lines: string[], name: string): string {
  const upperName = name.toUpperCase();
  const line = lines.find((candidate) => {
    const upper = candidate.toUpperCase();
    return upper.startsWith(`${upperName}:`) || upper.startsWith(`${upperName};`);
  });
  if (!line) return "";

  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return "";
  return line.slice(colonIndex + 1)
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value: string): Date | null {
  const clean = value.trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = "00", minute = "00", second = "00", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [yyyy, mm, dd, hh, min, ss] = parts;
  const timestamp = zone === "Z"
    ? Date.UTC(yyyy, mm - 1, dd, hh, min, ss)
    : new Date(yyyy, mm - 1, dd, hh, min, ss).getTime();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseIcsEvents(filePath: string, raw: string): CalendarEvent[] {
  const unfolded = unfoldIcs(raw);
  const events: CalendarEvent[] = [];
  const eventPattern = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match: RegExpExecArray | null;

  while ((match = eventPattern.exec(unfolded)) && events.length < MAX_CALENDAR_EVENTS) {
    const lines = match[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const start = parseIcsDate(readIcsProperty(lines, "DTSTART") || readIcsProperty(lines, "DUE"));
    if (!start) continue;

    const title = compactLine(readIcsProperty(lines, "SUMMARY") || "Untitled event", 140);
    const end = parseIcsDate(readIcsProperty(lines, "DTEND"));
    const location = compactLine(readIcsProperty(lines, "LOCATION"), 160);
    const description = compactLine(readIcsProperty(lines, "DESCRIPTION"), 220);

    events.push({
      filePath,
      startsAt: start,
      endsAt: end || undefined,
      title,
      location: location || undefined,
      description: description || undefined,
    });
  }

  return events;
}

function loadCalendarContext(): string {
  if (!fs.existsSync(CALENDAR_ICS_DIR)) return "";

  const now = Date.now();
  const startsAfter = now - 24 * 60 * 60 * 1000;
  const startsBefore = now + CALENDAR_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  const events: CalendarEvent[] = [];

  for (const filePath of collectIcsFiles()) {
    if (events.length >= MAX_CALENDAR_EVENTS) break;

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      events.push(...parseIcsEvents(filePath, raw));
    } catch {
      continue;
    }
  }

  const upcoming = events
    .filter((event) => event.startsAt.getTime() >= startsAfter && event.startsAt.getTime() <= startsBefore)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, MAX_CALENDAR_EVENTS);

  if (upcoming.length === 0) return "";

  const rows = upcoming.map((event) => {
    const relativePath = path.relative(CALENDAR_ICS_DIR, event.filePath);
    const attrs = [
      `file="${escapeAttribute(relativePath)}"`,
      `starts_at="${event.startsAt.toISOString()}"`,
      event.endsAt ? `ends_at="${event.endsAt.toISOString()}"` : "",
      event.location ? `location="${escapeAttribute(event.location)}"` : "",
    ].filter(Boolean).join(" ");
    const details = [event.title, event.description].filter(Boolean).join(" - ");
    return `<calendar_event ${attrs}>${guardContentTags(details)}</calendar_event>`;
  });

  return `<calendar_context source="ics-readonly" directory="${escapeAttribute(CALENDAR_ICS_DIR)}">\n${rows.join("\n")}\n</calendar_context>`;
}

export function loadVaultMarkdownContext(): string {
  const hasMarkdownVault = fs.existsSync(VAULT_DIR);
  const hasCalendarVault = fs.existsSync(CALENDAR_ICS_DIR);
  if (!hasMarkdownVault && !hasCalendarVault) return "";

  const files = hasMarkdownVault ? collectMarkdownFiles().slice(0, MAX_FILES) : [];
  let total = 0;
  const chunks: string[] = [];
  const signals: MemorySignal[] = [];

  for (const filePath of files) {
    if (total >= MAX_TOTAL_CHARS) break;

    try {
      const relativePath = path.relative(VAULT_DIR, filePath);
      const raw = fs.readFileSync(filePath, "utf8");
      const content = raw.slice(0, MAX_CHARS_PER_FILE);
      total += content.length;
      signals.push(...extractMarkdownSignals(relativePath, raw));
      chunks.push(`<markdown_file path="${escapeAttribute(relativePath)}">\n${guardContentTags(content)}\n</markdown_file>`);
    } catch {
      continue;
    }
  }

  const digest = buildMarkdownDigest(signals);
  if (digest) chunks.push(digest);

  const calendarContext = loadCalendarContext();
  if (calendarContext) chunks.push(calendarContext);

  return chunks.join("\n\n---\n\n").slice(0, MAX_TOTAL_CHARS);
}
