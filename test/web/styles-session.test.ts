// @vitest-environment happy-dom
// BUGFIX-LIST item 1: the shared styles list belongs to one session. A new session (sign-in, sign-out, a lost
// session) clears it; an answer that arrives after that is dropped; a refresh that fails for the new user leaves
// an empty list, never the previous user's.
import { beforeEach, describe, expect, it } from 'vitest';
import { newAuthEpoch } from '../../src/web/api';
import { currentStyles, refreshStyles, resetStyles } from '../../src/web/stylesStore';
import { mockFetch } from './harness';

const style = (name: string) => ({ id: `id-${name}`, name, font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null });
let answer: (r: { status: number; json?: unknown }) => void;
let slow: boolean;

beforeEach(() => {
  resetStyles();
  slow = false;
  mockFetch(() => (slow ? new Promise((ok) => (answer = ok)) : { status: 200, json: [style("Alice's")] }));
});

describe("the styles list across sessions", () => {
  it('a new session clears it', async () => {
    await refreshStyles();
    expect(currentStyles()!.map((s) => s.name)).toEqual(["Alice's"]);
    newAuthEpoch(); // sign-out, sign-in or a lost session
    expect(currentStyles()).toBeNull();
  });

  it("an answer for the previous session is dropped", async () => {
    slow = true;
    const late = refreshStyles();
    newAuthEpoch();
    answer({ status: 200, json: [style("Alice's")] });
    await late;
    expect(currentStyles()).toBeNull();
  });

  it("a failed refresh for the new user leaves an empty list, not the previous user's", async () => {
    await refreshStyles();
    newAuthEpoch();
    mockFetch(() => ({ status: 500, json: { error: { code: 'x', message: 'x' } } }));
    await refreshStyles();
    expect(currentStyles()).toEqual([]);
  });
});
