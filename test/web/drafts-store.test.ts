// @vitest-environment happy-dom
// localDrafts keeps one draft per editor (tab) per note (BUGFIX-LIST-2 item 3), so two tabs with unsaved changes
// to one note both keep them; a note with any draft counts once.
import { afterEach, describe, expect, it } from 'vitest';
import { localDrafts, type Draft } from '../../src/web/drafts';

const draft = (title: string, owner: string | undefined, savedAt: number): Draft => ({ title, body: {}, version: 1, savedAt, owner });
afterEach(() => localStorage.clear());

describe('one draft per tab', () => {
  it('two tabs keep their own drafts of a note; the newest is the one offered', () => {
    localDrafts.set('u', 'n1', draft('A', 'tab-a', 1));
    localDrafts.set('u', 'n1', draft('B', 'tab-b', 2));
    expect(localDrafts.get('u', 'n1')?.title).toBe('B');
    expect(localDrafts.get('u', 'n1', 'tab-b')?.title).toBe('A'); // other tabs' drafts, for tab B
    expect(localDrafts.list('u')).toEqual(['n1']);
    localDrafts.removeOne('u', 'n1', 'tab-b');
    expect(localDrafts.get('u', 'n1')?.title).toBe('A');
  });

  it('a draft written before owners existed is still read, and removing a note removes all of its drafts', () => {
    localStorage.setItem('draft:u:n1', JSON.stringify(draft('legacy', undefined, 1)));
    localDrafts.set('u', 'n1', draft('B', 'tab-b', 0));
    localDrafts.set('u', 'n2', draft('other note', 'tab-b', 0));
    expect(localDrafts.get('u', 'n1')?.title).toBe('legacy');
    expect(localDrafts.list('u').sort()).toEqual(['n1', 'n2']);
    localDrafts.remove('u', 'n1');
    expect(localDrafts.get('u', 'n1')).toBeNull();
    expect(localDrafts.get('u', 'n2')?.title).toBe('other note');
  });

  it("sign-out removes every draft of the user, and only the user's", () => {
    localDrafts.set('u', 'n1', draft('A', 'tab-a', 1));
    localDrafts.set('u', 'n1', draft('B', 'tab-b', 2));
    localDrafts.set('v', 'n1', draft('V', 'tab-v', 3));
    localDrafts.removeAllFor('u');
    expect(localDrafts.list('u')).toEqual([]);
    expect(localDrafts.get('v', 'n1')?.title).toBe('V');
  });
});
