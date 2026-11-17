// @vitest-environment happy-dom
// BUGFIX-LIST item 16: a dialog takes the keyboard focus when it opens, keeps Tab inside it, and gives the focus back
// to what opened it when it closes (by a choice, Cancel or Escape).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogProvider, useDialogs, type DialogApi } from '../../src/web/components/Dialogs';
import { button, click, render, settle } from './harness';

let view: Awaited<ReturnType<typeof render>> | null = null;
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

let dialogs: DialogApi;
function Opener() {
  dialogs = useDialogs();
  return <button id="opener">Move to…</button>;
}
const folders = [
  { id: 'f1', name: 'Inbox', isInbox: true, children: [] },
  { id: 'f2', name: 'Work', isInbox: false, children: [] },
] as any;
const modal = () => document.querySelector('.modal') as HTMLElement | null;
const key = async (k: string, shift = false) =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
  });

async function openFrom(open: () => Promise<unknown>) {
  view = await render(
    <DialogProvider>
      <Opener />
    </DialogProvider>,
  );
  const opener = document.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = open();
  });
  await settle();
  return { opener, result };
}

describe('dialogs and the keyboard focus', () => {
  it('the folder picker: focus on the current folder, Tab stays inside, Escape gives it back to the opener', async () => {
    const { opener, result } = await openFrom(() => dialogs.pickFolder({ title: 'Move to', folders, current: 'f2' }));
    expect(modal()!.contains(document.activeElement)).toBe(true); // before: still on the opener, behind the modal
    expect(document.activeElement?.textContent).toBe('Work');
    await key('Tab'); // Work → Cancel
    expect(document.activeElement?.textContent).toBe('Cancel');
    await key('Tab'); // wraps to the first
    expect(modal()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('Inbox');
    await key('Tab', true); // Shift+Tab wraps back to the last
    expect(document.activeElement?.textContent).toBe('Cancel');
    await key('Escape');
    await settle();
    expect(modal()).toBeNull();
    expect(await result).toBeNull();
    expect(document.activeElement).toBe(opener); // before: the page body
  });

  it('a prompt: focus in its field; after OK the focus is back on the opener', async () => {
    const { opener, result } = await openFrom(() => dialogs.prompt({ title: 'Link', label: 'Address', initial: 'https://a.example' }));
    expect(document.activeElement?.tagName).toBe('INPUT');
    await click(button(modal()!, 'OK'));
    await settle();
    expect(await result).toBe('https://a.example');
    expect(document.activeElement).toBe(opener);
  });

  it('a choice: focus on its first button; after a choice the focus is back on the opener', async () => {
    const { opener, result } = await openFrom(() => dialogs.choose({ title: 'Conflict', message: 'm', options: [{ label: 'Keep mine', value: 'mine' }, { label: 'Take theirs', value: 'theirs' }] }));
    expect(document.activeElement?.textContent).toBe('Keep mine');
    await click(button(modal()!, 'Take theirs'));
    await settle();
    expect(await result).toBe('theirs');
    expect(document.activeElement).toBe(opener);
  });
});
