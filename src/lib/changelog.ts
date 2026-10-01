/**
 * Parse Keep-a-Changelog markdown into structured release entries.
 */
import changelogRaw from '../../CHANGELOG.md?raw';

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

function flattenContinuation(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s+/.test(line) && out.length > 0 && !line.trimStart().startsWith('-')) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

export function parseChangelog(markdown: string = changelogRaw): ChangelogEntry[] {
  const lines = flattenContinuation(markdown.replace(/\r\n/g, '\n').split('\n'));
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^##\s+\[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) {
      if (current) entries.push(current);
      current = {
        version: heading[1],
        date: heading[2] ?? null,
        sections: [],
      };
      section = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = /^###\s+(.+)$/.exec(line.trim());
    if (sectionMatch) {
      section = { title: sectionMatch[1].trim(), items: [] };
      current.sections.push(section);
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line.trim());
    if (itemMatch) {
      if (!section) {
        section = { title: 'Notes', items: [] };
        current.sections.push(section);
      }
      section.items.push(itemMatch[1].trim());
    }
  }
  if (current) entries.push(current);

  return entries.filter((e) => e.version.toLowerCase() !== 'unreleased' || e.sections.length > 0);
}

export function getChangelogEntries(): ChangelogEntry[] {
  return parseChangelog();
}
