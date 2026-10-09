import type { Db } from '../db';
import { saveScheme, type SchemeInput } from './schemes';

export type PortalKind = 'myscheme' | 'ippb';

export interface PortalSchemeRecord {
  name: string;
  sourceUrl: string;
  summary: string;
  department?: string;
  category?: string;
  goal?: string;
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
const stripHtml = (value: string) => normalizeWhitespace(value.replace(/<[^>]*>/g, ' '));
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'portal-scheme';

function deriveDepartment(rawHtml: string, portal: PortalKind): string {
  const departments = [...rawHtml.matchAll(/(?:Ministry Of|Department Of|Department|Ministry)\s+[A-Za-z0-9 &()/-]+/gi)];
  const literal = departments.at(0)?.[0]?.replace(/^\s+|\s+$/g, '') ?? (portal === 'myscheme' ? 'Government portal' : 'India Post Payments Bank');
  return literal.length > 2 ? literal : 'Government portal';
}

function deriveCategory(rawHtml: string, portal: PortalKind): string {
  const hints = ['Agriculture', 'Finance', 'Education', 'Health', 'Housing', 'Women', 'Business', 'Social Welfare', 'Employment'];
  const text = normalizeWhitespace(rawHtml).toLowerCase();
  const match = hints.find((flag) => text.includes(flag.toLowerCase()));
  return match ?? (portal === 'ippb' ? 'Finance' : 'Government');
}

function parseSummary(anchorHtml: string, sourceHtml: string, portal: PortalKind): string {
  const anchorText = stripHtml(anchorHtml);
  const context = sourceHtml.slice(Math.max(0, sourceHtml.indexOf(anchorHtml) - 120), Math.min(sourceHtml.length, sourceHtml.indexOf(anchorHtml) + 500));
  const paragraph = [...context.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .find((value) => value && value.length > 20);
  return normalizeWhitespace(paragraph || anchorText || `${portal === 'myscheme' ? 'Government scheme' : 'Portfolio scheme'} listed on the official portal.`);
}

export function parsePublicSchemeListings(portal: PortalKind, html: string): PortalSchemeRecord[] {
  const source = html || '';
  const anchors = [...source.matchAll(/<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const dedup = new Map<string, PortalSchemeRecord>();

  for (const match of anchors) {
    const href = match[1];
    const name = stripHtml(match[2]);
    if (!name || name.length < 4) continue;
    const hostCheck = portal === 'myscheme' ? href.includes('myscheme.gov.in') : href.includes('ippb') || href.includes('ippbonline.com');
    if (!hostCheck) continue;
    const normalized = normalizeWhitespace(name);
    const key = `${portal}:${href}`;
    if (dedup.has(key)) continue;

    const summary = parseSummary(match[0], source, portal);
    dedup.set(key, {
      name: normalized,
      sourceUrl: href,
      summary,
      department: deriveDepartment(source, portal),
      category: deriveCategory(source, portal),
      goal: portal === 'myscheme' ? 'government-support' : 'finance',
    });
  }

  if (!dedup.size) {
    const fallback = [...source.matchAll(/(?:<h3[^>]*>|<h2[^>]*>|<li[^>]*>)([\s\S]*?)(?:<\/h3>|<\/h2>|<\/li>)/gi)]
      .map((match) => stripHtml(match[1]))
      .filter((value) => value && value.length > 6)
      .slice(0, 20);
    return fallback.map((title, index) => ({
      name: title,
      sourceUrl: `https://${portal === 'myscheme' ? 'www.myscheme.gov.in' : 'www.ippb.in'}/portal-${index + 1}`,
      summary: `${title} appears in the public ${portal === 'myscheme' ? 'myScheme' : 'IPPB'} listing and must be verified before applying.`,
      department: deriveDepartment(source, portal),
      category: deriveCategory(source, portal),
      goal: portal === 'myscheme' ? 'government-support' : 'finance',
    }));
  }

  return [...dedup.values()];
}

export async function importPublicPortalSchemes(db: Db, portal: PortalKind, urls: string[]): Promise<{ imported: number; skipped: number; sourceUrl: string[] }> {
  const results: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (const url of urls) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      skipped++;
      results.push(url);
      continue;
    }
    const html = await response.text();
    const items = parsePublicSchemeListings(portal, html);
    for (const item of items) {
      const slug = slugify(item.name);
      const exists = await db.query('select id from schemes where source_url=$1 or slug=$2', [item.sourceUrl, slug]);
      if (exists.length) {
        skipped++;
        continue;
      }
      const input: SchemeInput = {
        slug,
        name: item.name,
        department: item.department ?? 'Official portal',
        category: item.category ?? (portal === 'ippb' ? 'Finance' : 'Government'),
        summary: item.summary,
        benefitText: item.summary,
        benefitValue: 0,
        goal: item.goal ?? 'government-support',
        sourceUrl: item.sourceUrl,
        isDemo: false,
        rules: [{
          field: 'category',
          op: 'manual',
          value: 'This imported record came from a public portal listing and needs department verification before application.',
          label: 'Verification status',
        }],
        documents: [],
      };
      await saveScheme(db, input, { status: 'published' });
      imported++;
      results.push(item.sourceUrl);
    }
  }

  return { imported, skipped, sourceUrl: results };
}
