// Agent Markdown converter limits (SPEC 8.3; review finding: wide tables).
import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '../src/server/markdown.js';
import { validateBody } from '../src/shared/schema.js';

describe('markdown tables', () => {
  it('rejects a small table that would pad out to more cells than fit in 1 MB, before building it', () => {
    const cols = 1000;
    const md = '|' + 'a|'.repeat(cols) + '\n|' + '-|'.repeat(cols) + '\n' + '|x|\n'.repeat(4000);
    expect(Buffer.byteLength(md)).toBeLessThan(100_000);
    const t = Date.now();
    const before = process.memoryUsage().rss;
    expect(() => markdownToDoc(md)).toThrow(/1 MB/);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(process.memoryUsage().rss - before).toBeLessThan(200 * 1024 * 1024);
  });

  it('the budget counts all tables together', () => {
    const table = '|' + 'a|'.repeat(100) + '\n|' + '-|'.repeat(100) + '\n' + '|x|\n'.repeat(19);
    expect(() => markdownToDoc(Array.from({ length: 10 }, () => table).join('\n'))).toThrow(/1 MB/);
  });

  it('still converts ordinary tables', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 |\n';
    const v = validateBody(markdownToDoc(md));
    const table = (v.json.content as any[])[0];
    expect(table.content).toHaveLength(3);
    expect(table.content[2].content).toHaveLength(2); // the short row is padded
  });
});
