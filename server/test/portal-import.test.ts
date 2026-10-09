import { describe, expect, it, vi } from 'vitest';
import * as schemes from '../src/services/schemes';
import { importPublicPortalSchemes, parsePublicSchemeListings } from '../src/services/portal-import';
import { importKaggleDataset, parseKaggleDataset } from '../src/services/kaggle-import';

describe('parsePublicSchemeListings', () => {
  it('parses myScheme search HTML into scheme records', () => {
    const html = `
      <html>
        <body>
          <a href="https://www.myscheme.gov.in/schemes/abc">Student Scholarship Support</a>
          <p>Financial support for eligible students from low-income families.</p>
          <a href="https://www.myscheme.gov.in/schemes/def">Farm Loan Support</a>
          <p>Credit support for farmers with land records and bank accounts.</p>
        </body>
      </html>
    `;

    const items = parsePublicSchemeListings('myscheme', html);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'Student Scholarship Support',
      sourceUrl: 'https://www.myscheme.gov.in/schemes/abc',
      summary: expect.stringContaining('Financial support for eligible students'),
      department: expect.any(String),
      category: expect.any(String),
    });
  });

  it('parses IPPB-style product cards into scheme records', () => {
    const html = `
      <html>
        <body>
          <div class="product-card">
            <h3><a href="https://www.ippb.in/schemes/ippsavings">IPPB Savings Scheme</a></h3>
            <p>Small savings accounts with government-backed interest features.</p>
          </div>
          <div class="product-card">
            <h3><a href="https://www.ippb.in/schemes/post-office-td">IPPB Time Deposit</a></h3>
            <p>Fixed-term deposit product for secure savings and recurring deposits.</p>
          </div>
        </body>
      </html>
    `;

    const items = parsePublicSchemeListings('ippb', html);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'IPPB Savings Scheme',
      sourceUrl: 'https://www.ippb.in/schemes/ippsavings',
      summary: expect.stringContaining('Small savings accounts'),
      category: 'Finance',
    });
  });

  it('publishes imported public portal entries immediately', async () => {
    vi.spyOn(schemes, 'saveScheme').mockResolvedValue('imported-id');
    const db = { query: vi.fn().mockResolvedValue([]) } as any;
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <body>
            <a href="https://www.myscheme.gov.in/schemes/test-scheme">Test Scheme</a>
            <p>Support for eligible citizens using the official government listing.</p>
          </body>
        </html>
      `,
    }) as any;

    try {
      const report = await importPublicPortalSchemes(db, 'myscheme', ['https://www.myscheme.gov.in/search']);
      expect(report.imported).toBe(1);
      expect(schemes.saveScheme).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ name: 'Test Scheme' }),
        expect.objectContaining({ status: 'published' }),
      );
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  it('parses Kaggle CSV rows into published scheme records', async () => {
    const csv = [
      'name,department,summary,category,source_url',
      'PMEGP Loan,MSME,Support for micro-enterprise borrowers,Agriculture,https://example.org/schemes/pmf',
      'Crop Insurance Support,Department of Agriculture,Insurance support for weather crop losses,Finance,https://example.org/schemes/crop-insurance',
    ].join('\n');

    const items = parseKaggleDataset(csv, 'csv');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'PMEGP Loan',
      department: 'MSME',
      category: 'Agriculture',
      sourceUrl: 'https://example.org/schemes/pmf',
    });

    vi.spyOn(schemes, 'saveScheme').mockResolvedValue('kaggle-scheme-id');
    const db = { query: vi.fn().mockResolvedValue([]) } as any;

    try {
      const report = await importKaggleDataset(db, csv, { format: 'csv', sourceName: 'kaggle-demo' });
      expect(report.imported).toBe(2);
      expect(schemes.saveScheme).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ name: 'PMEGP Loan' }),
        expect.objectContaining({ status: 'published' }),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
