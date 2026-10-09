import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Db } from '../db';
import { saveScheme, type SchemeInput } from './schemes';

export type KaggleImportFormat = 'auto' | 'csv' | 'json';

export interface KaggleSchemeRecord {
  name: string;
  department?: string;
  category?: string;
  summary?: string;
  benefitText?: string;
  sourceUrl?: string;
  goal?: string;
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kaggle-scheme';

const pickValue = (row: Record<string, any>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate === null || candidate === undefined) continue;
    const normalized = String(candidate).trim();
    if (normalized) return normalized;
  }
  return undefined;
};

const inferCategory = (text: string): string => {
  const haystack = text.toLowerCase();
  const hints = ['agriculture', 'farmer', 'crop', 'irrigation', 'finance', 'loan', 'bank', 'insurance', 'education', 'scholarship', 'health', 'housing', 'women', 'business', 'employment', 'skill', 'pension'];
  const match = hints.find((hint) => haystack.includes(hint));
  return match ? match.charAt(0).toUpperCase() + match.slice(1) : 'Government';
};

const inferGoal = (text: string): string => {
  const haystack = text.toLowerCase();
  if (haystack.includes('agriculture') || haystack.includes('farmer') || haystack.includes('crop')) return 'agriculture';
  if (haystack.includes('education') || haystack.includes('scholarship') || haystack.includes('student')) return 'education';
  if (haystack.includes('loan') || haystack.includes('finance') || haystack.includes('insurance') || haystack.includes('bank')) return 'finance';
  if (haystack.includes('health')) return 'health';
  if (haystack.includes('housing') || haystack.includes('home')) return 'housing';
  if (haystack.includes('women')) return 'women';
  if (haystack.includes('business') || haystack.includes('entrepreneur')) return 'business';
  return 'government-support';
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.replace(/\r$/, '').trim());
};

const parseCsvRows = (input: string): Record<string, string>[] => {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index++) {
      const key = headers[index] || `column_${index}`;
      record[key] = values[index] ?? '';
    }
    return record;
  });
};

const normalizeKaggleRecord = (row: Record<string, any>): KaggleSchemeRecord | null => {
  const rawName = pickValue(row, ['name', 'scheme_name', 'scheme', 'title', 'scheme_title', 'program_name', 'program']);
  if (!rawName) return null;

  const department = pickValue(row, ['department', 'ministry', 'agency', 'organization', 'department_name', 'implementing_department']) ?? 'Government portal';
  const category = pickValue(row, ['category', 'sector', 'scheme_category', 'type', 'schemeType', 'class']) ?? inferCategory(`${rawName} ${department}`);
  const summary = pickValue(row, ['summary', 'description', 'details', 'objective', 'scheme_details', 'about', 'overview']) ?? `${rawName} is listed in the imported Kaggle dataset and should be verified against the official scheme source.`;
  const benefitText = pickValue(row, ['benefit', 'benefit_text', 'benefits', 'support', 'subsidy', 'assistance']) ?? summary;
  const sourceUrl = pickValue(row, ['source_url', 'sourceUrl', 'url', 'website', 'link', 'official_url']) ?? undefined;
  const goal = pickValue(row, ['goal', 'purpose', 'target']) ?? inferGoal(`${rawName} ${summary}`);

  return {
    name: normalizeWhitespace(rawName),
    department: normalizeWhitespace(department),
    category: normalizeWhitespace(category),
    summary: normalizeWhitespace(summary),
    benefitText: normalizeWhitespace(benefitText),
    sourceUrl: sourceUrl ? normalizeWhitespace(sourceUrl) : undefined,
    goal,
  };
};

export function parseKaggleDataset(input: string, format: KaggleImportFormat = 'auto'): KaggleSchemeRecord[] {
  if (!input || !input.trim()) return [];

  const resolvedFormat = format === 'auto'
    ? (input.trim().startsWith('{') || input.trim().startsWith('[') ? 'json' : 'csv')
    : format;

  if (resolvedFormat === 'json') {
    const parsed = JSON.parse(input);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.records) ? (parsed as any).records : [parsed];
    return rows
      .filter((row: unknown) => !!row && typeof row === 'object')
      .map((row: unknown) => normalizeKaggleRecord(row as Record<string, any>))
      .filter((row: KaggleSchemeRecord | null): row is KaggleSchemeRecord => !!row);
  }

  return parseCsvRows(input)
    .map((row) => normalizeKaggleRecord(row))
    .filter((row): row is KaggleSchemeRecord => !!row);
}

export async function importKaggleDataset(db: Db, source: string, opts: { format?: KaggleImportFormat; sourceName?: string } = {}): Promise<{ imported: number; skipped: number; sourceName?: string; sourceUrl: string[] }> {
  let raw = source;
  const filePath = existsSync(source) ? source : undefined;

  if (filePath) {
    raw = await readFile(filePath, 'utf8');
  }

  const items = parseKaggleDataset(raw, opts.format ?? 'auto');
  const sourceUrl: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    const slug = slugify(item.name);
    const sourceUrlValue = item.sourceUrl ?? source;
    const exists = await db.query('select id from schemes where source_url=$1 or slug=$2', [sourceUrlValue, slug]);
    if (exists.length) {
      skipped++;
      continue;
    }

    const input: SchemeInput = {
      slug,
      name: item.name,
      department: item.department ?? 'Government portal',
      category: item.category ?? inferCategory(item.name),
      summary: item.summary ?? `${item.name} is listed in the imported Kaggle dataset.`,
      benefitText: item.benefitText ?? item.summary ?? `${item.name} is listed in the imported Kaggle dataset.`,
      benefitValue: 0,
      goal: item.goal ?? inferGoal(item.name),
      sourceUrl: item.sourceUrl ?? source,
      isDemo: false,
      rules: [{
        field: 'category',
        op: 'manual',
        value: 'Imported from a Kaggle dataset. Verify against the official government source before application.',
        label: 'Verification status',
      }],
      documents: [],
    };

    await saveScheme(db, input, { status: 'published' });
    imported++;
    sourceUrl.push(sourceUrlValue);
  }

  return { imported, skipped, sourceName: opts.sourceName, sourceUrl };
}
