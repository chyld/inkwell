// @vitest-environment happy-dom
// Image uploads while the note keeps changing or closes (review finding).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { noteExtensions } from '../../src/shared/schema';
import { cancelUploads, hasPendingUploads, useImageUpload, waitForUploads } from '../../src/web/components/images';
import { requests } from './harness';
import { mockFetch, render, settle, waitFor } from './harness';

const IMG = '22222222-2222-4222-8222-222222222222';
let release: () => void = () => {};

function setup() {
  const gate = new Promise<void>((r) => (release = r));
  mockFetch(async (method, path) => {
    if (method === 'POST' && path === '/api/images') {
      await gate;
      return { status: 201, json: { id: IMG, src: `/api/images/${IMG}` } };
    }
    return { status: 404, json: {} };
  });
  const editor = new Editor({ extensions: noteExtensions, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'server text' }] }] } });
  const dialogs = { notice: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), choose: vi.fn(), pickFolder: vi.fn() };
  let api: ReturnType<typeof useImageUpload> | null = null;
  function Probe() {
    const ref = useRef<any>(editor);
    api = useImageUpload(ref, dialogs as any, () => {});
    return api.input;
  }
  return { editor, dialogs, Probe, api: () => api! };
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' });
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  release();
  await cleanup?.();
  cleanup = null;
});

describe('image uploads', () => {
  it('a dropped image lands where it was dropped even if the note changed during the upload', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    const dropAt = t.editor.state.doc.content.size; // after the paragraph
    await act(async () => {
      t.api().handleFiles([png()] as any, dropAt);
    });
    t.editor.commands.insertContentAt(1, 'PREFIX '); // typed while uploading
    release();
    await waitFor(() => JSON.stringify(t.editor.getJSON()).includes(IMG), 3000, 'image');
    const json = t.editor.getJSON() as any;
    // The paragraph stays whole and the image follows it (an empty trailing paragraph
    // may follow, added by the editor's trailing-node rule).
    expect(json.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'PREFIX server text' }] });
    expect(json.content[1].type).toBe('image');
    expect(json.content.slice(2).every((n: any) => n.type === 'paragraph' && !n.content)).toBe(true);
  });

  it('an upload that finishes after the note was closed is reported, not silently dropped', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    await act(async () => {
      t.api().handleFiles([png()] as any);
    });
    t.editor.destroy();
    release();
    await waitFor(() => t.dialogs.notice.mock.calls.length > 0, 3000, 'notice');
    expect(String(t.dialogs.notice.mock.calls[0][0])).toMatch(/not added/);
  });

  it('switching notes can wait for uploads that are still running', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    await act(async () => {
      t.api().handleFiles([png()] as any);
    });
    let done = false;
    const w = waitForUploads(3000).then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    release();
    await w;
    expect(JSON.stringify(t.editor.getJSON())).toContain(IMG);
  });

  it('a queued upload does not start after sign-out (it would be sent with the next user’s session)', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    await act(async () => {
      t.api().handleFiles([png(), png()] as any);
    });
    await waitFor(() => requests.filter((r) => r.path === '/api/images').length === 1, 2000, 'first upload');
    cancelUploads(); // sign-out
    release();
    await settle();
    await settle();
    expect(requests.filter((r) => r.path === '/api/images')).toHaveLength(1);
  });

  it('a queued upload does not start after the note is closed', async () => {
    const t = setup();
    const r = await render(<t.Probe />);
    await act(async () => {
      t.api().handleFiles([png(), png()] as any);
    });
    await waitFor(() => requests.filter((x) => x.path === '/api/images').length === 1, 2000, 'first upload');
    await r.unmount();
    release();
    await settle();
    await settle();
    expect(requests.filter((x) => x.path === '/api/images')).toHaveLength(1);
  });

  it('reports pending uploads (for the leave-site warning) until they finish', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    expect(hasPendingUploads()).toBe(false);
    await act(async () => {
      t.api().handleFiles([png()] as any);
    });
    expect(hasPendingUploads()).toBe(true);
    release();
    await waitForUploads(3000);
    expect(hasPendingUploads()).toBe(false);
  });

  it('an upload left running by a signed-out user does not count as pending for the next user', async () => {
    const t = setup();
    cleanup = (await render(<t.Probe />)).unmount;
    await act(async () => {
      t.api().handleFiles([png()] as any);
    });
    expect(hasPendingUploads()).toBe(true);
    cancelUploads(); // sign-out
    expect(hasPendingUploads()).toBe(false);
    expect(await waitForUploads(50)).toBe(true);
  });
});


describe('several images dropped at once (BUGFIX-LIST item 21)', () => {
  // BUGFIX-LIST-2 item 2: an image is a block, so a drop inside a paragraph puts it after (or splitting) that
  // paragraph, beyond the drop position; the next one must still go after it.
  const dropAt = async (where: (doc: any) => number) => {
    const t = setup();
    let n = 0;
    mockFetch(async (method, path) => {
      if (method === 'POST' && path === '/api/images') {
        const id = `22222222-2222-4222-8222-00000000000${++n}`;
        return { status: 201, json: { id, src: `/api/images/${id}` } };
      }
      return { status: 404, json: {} };
    });
    t.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'above' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'below' }] }] });
    cleanup = (await render(<t.Probe />)).unmount;
    const file = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    await act(async () => {
      t.api().handleFiles([file('one.png'), file('two.png'), file('three.png')] as any, where(t.editor.state.doc));
    });
    await waitFor(() => (JSON.stringify(t.editor.getJSON()).match(/"image"/g) ?? []).length === 3, 3000, 'three images');
    return (t.editor.getJSON() as any).content.map((c: any) => (c.type === 'image' ? c.attrs.alt : c.content?.[0]?.text));
  };
  it('at the end of a paragraph, land after it in their order', async () => {
    expect(await dropAt((doc) => 1 + doc.child(0).content.size)).toEqual(['above', 'one', 'two', 'three', 'below']); // before: three, two, one
  });
  it('inside a paragraph, land at the split in their order', async () => {
    expect(await dropAt(() => 3)).toEqual(['ab', 'one', 'two', 'three', 'ove', 'below']);
  });
  it('land at the drop point in the order they were dropped', async () => {
    const t = setup();
    let n = 0;
    mockFetch(async (method, path) => {
      if (method === 'POST' && path === '/api/images') {
        const id = `22222222-2222-4222-8222-00000000000${++n}`;
        return { status: 201, json: { id, src: `/api/images/${id}` } };
      }
      return { status: 404, json: {} };
    });
    t.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'above' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'below' }] }] });
    cleanup = (await render(<t.Probe />)).unmount;
    const between = t.editor.state.doc.child(0).nodeSize; // between the two paragraphs
    const file = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    await act(async () => {
      t.api().handleFiles([file('one.png'), file('two.png'), file('three.png')] as any, between);
    });
    await waitFor(() => (JSON.stringify(t.editor.getJSON()).match(/"image"/g) ?? []).length === 3, 3000, 'three images');
    const json = t.editor.getJSON() as any;
    expect(json.content.map((c: any) => (c.type === 'image' ? c.attrs.alt : c.content?.[0]?.text))).toEqual(['above', 'one', 'two', 'three', 'below']); // before: three, two, one
  });
});
