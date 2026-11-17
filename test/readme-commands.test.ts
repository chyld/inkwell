// BUGFIX-LIST item 22: every username in the README's `notes user add` and `notes agent add` commands is one the
// app accepts (section 8 used "me", which it refuses as too short).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkUsername, normalizeUsername } from '../src/server/store/identity.js';

const readme = fs.readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');

describe('the README’s commands', () => {
  it('use usernames the app accepts', () => {
    const names = [...readme.matchAll(/notes (?:user|agent) add (\S+)/g)].map((m) => m[1]).filter((n) => !n.startsWith('<'));
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names.filter((n) => checkUsername(normalizeUsername(n)) !== null)).toEqual([]); // before: ['me', 'me']
  });
});
