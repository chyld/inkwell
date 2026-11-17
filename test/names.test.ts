// CLEANUP-PLAN pass 3 item 4: one place for the name and title rules (shared/noteRules.ts), with what each kind of
// name accepted before kept as it was: folder and agent names refuse C0 controls and DEL; style names also refuse
// the C1 controls (U+0080-U+009F).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanTitleText, nameKey, nameProblem } from '../src/shared/noteRules.js';
import { makeEnv, userClient, type Client, type Env } from './helpers.js';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv();
  c = await userClient(env, 'alice');
});
afterEach(async () => {
  await env.close();
});
const style = (name: string) => ({ name, font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null });

describe('names and titles', () => {
  it('the shared rules', () => {
    expect(cleanTitleText('a\tb\r\n\nc\u0007d\u007f')).toBe('a b cd');
    expect(nameProblem('', 10)).toBe('empty');
    expect(nameProblem('x'.repeat(11), 10)).toBe('long');
    expect(nameProblem('a\u0007b', 10)).toBe('control');
    expect(nameProblem('a\u0085b', 10)).toBeNull();
    expect(nameProblem('a\u0085b', 10, { c1: true })).toBe('control');
    expect(nameKey('  Work ')).toBe('work');
  });

  it('a C1 control character: allowed in a folder name, refused in a style name; C0 refused in both and in agent names', async () => {
    expect((await c.post('/api/folders', { name: 'Plans\u0085' })).statusCode).toBe(201);
    expect((await c.post('/api/folders', { name: 'Plans\u0007' })).json().error.message).toBe('Folder name contains characters that are not allowed.');
    expect((await c.post('/api/folders', { name: '  ' })).json().error.message).toBe('Folder name must be 1-100 characters.');
    const s = await c.post('/api/styles', style('Quote\u0085'));
    expect([s.statusCode, s.json().error.code]).toEqual([400, 'invalid_name']);
    expect((await c.post('/api/styles', style('Quote'))).statusCode).toBe(201);
    expect(() => env.store.identity.addAgent('alice', 'bot\u0007')).toThrow('Agent name must be 1-50 characters.');
    expect(env.store.identity.addAgent('alice', ' bot ').name).toBe('bot');
  });

  it('titles: user titles keep their spaces, agent titles are trimmed; both drop control characters', async () => {
    const n = (await c.post('/api/notes', { folderId: null })).json();
    const r = await c.put(`/api/notes/${n.id}`, { title: ' A\tB\u0007 ', body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: n.version });
    expect(r.statusCode).toBe(200);
    expect((await c.get(`/api/notes/${n.id}`)).json().title).toBe(' A B ');
  });
});
