// Agent Markdown converter limits (SPEC 8.3; review finding: wide tables).
import { describe, expect, it } from 'vitest';
import { conversionStats, markdownToDoc, MAX_TABLE_CELLS } from '../src/server/markdown.js';
import { validateBody } from '../src/shared/schema.js';

describe('markdown tables', () => {
  it('rejects a small table that would pad out to more cells than fit in 1 MB, before building it', () => {
    const cols = 1000;
    const md = '|' + 'a|'.repeat(cols) + '\n|' + '-|'.repeat(cols) + '\n' + '|x|\n'.repeat(4000);
    expect(Buffer.byteLength(md)).toBeLessThan(100_000);
    conversionStats.cellsBuilt = 0;
    expect(() => markdownToDoc(md)).toThrow(/1 MB/);
    // Rejected before a single cell was built (without the budget: 4,000,000 padded cells).
    expect(conversionStats.cellsBuilt).toBe(0);
  });

  it('the budget counts all tables together', () => {
    const table = '|' + 'a|'.repeat(100) + '\n|' + '-|'.repeat(100) + '\n' + '|x|\n'.repeat(19);
    conversionStats.cellsBuilt = 0;
    expect(() => markdownToDoc(Array.from({ length: 10 }, () => table).join('\n'))).toThrow(/1 MB/);
    // Five 2,000-cell tables fit the budget; the sixth is refused before it is built.
    expect(conversionStats.cellsBuilt).toBe(10_000);
    expect(conversionStats.cellsBuilt).toBeLessThanOrEqual(MAX_TABLE_CELLS);
  });

  it('still converts ordinary tables', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 |\n';
    conversionStats.cellsBuilt = 0;
    const v = validateBody(markdownToDoc(md));
    expect(conversionStats.cellsBuilt).toBe(6);
    const table = (v.json.content as any[])[0];
    expect(table.content).toHaveLength(3);
    expect(table.content[2].content).toHaveLength(2); // the short row is padded
  });
});
