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
});

