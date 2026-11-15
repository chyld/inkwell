import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { api, ApiError } from '../api';
import type { DialogApi } from './Dialogs';

const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Uploads still running, in any note. Switching notes or signing out waits for them (briefly). */
const pendingUploads = new Map<Promise<unknown>, number>(); // job -> upload epoch

/** Bumped by cancelUploads (sign-out): batches started before it upload nothing more. */
let uploadEpoch = 0;
export function cancelUploads() {
  uploadEpoch++;
}

/** Uploads started since the last sign-out (an earlier user's are not this user's business). */
function currentUploads(): Promise<unknown>[] {
  return [...pendingUploads].filter(([, e]) => e === uploadEpoch).map(([job]) => job);
}

export function hasPendingUploads(): boolean {
  return currentUploads().length > 0;
}

/** Wait until running uploads have finished, or `ms` has passed. Resolves true if none is left. */
export async function waitForUploads(ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (currentUploads().length > 0) {
    const left = end - Date.now();
    if (left <= 0) return false;
    await Promise.race([Promise.allSettled(currentUploads()), new Promise((r) => setTimeout(r, left))]);
  }
  return true;
}
const MAX = 10 * 1024 * 1024;

/** Upload button, paste and drop for images (SPEC 6.5). */
export function useImageUpload(editorRef: MutableRefObject<Editor | null>, dialogs: DialogApi, onStorageChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Closing the note stops a batch: files not yet sent are not sent.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  async function uploadOne(file: File, dropPos?: number) {
    if (!ACCEPT.includes(file.type)) {
      dialogs.notice(`“${file.name}” is not a PNG, JPEG, GIF or WebP image.`);
      return;
    }
    if (file.size > MAX) {
      dialogs.notice(`“${file.name}” is larger than 10 MB.`);
      return;
    }
    const form = new FormData();
    form.append('file', file, file.name);
    // Keep the drop position pointing at the same place while the note changes during the upload.
    const started = editorRef.current;
    let pos = dropPos;
    const track = ({ transaction }: { transaction: { mapping: { map(p: number): number } } }) => {
      if (pos !== undefined) pos = transaction.mapping.map(pos);
    };
    if (started && pos !== undefined) started.on('transaction', track);
    try {
      const r = await api<{ id: string; src: string }>('POST', '/images', undefined, { form });
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed || ed !== started) {
        dialogs.notice(`“${file.name}” finished uploading after the note was closed, so it was not added to the note.`);
        return;
      }
      const node = { type: 'image', attrs: { src: r.src, alt: file.name.replace(/\.[a-z0-9]+$/i, '') } };
      if (pos !== undefined) ed.chain().focus().insertContentAt(Math.min(pos, ed.state.doc.content.size), node).run();
      else ed.chain().focus().insertContent(node).run();
      onStorageChanged();
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? `Image not added: ${e.message}` : 'Image not added: the server could not be reached.');
    } finally {
      if (started && !started.isDestroyed) started.off('transaction', track);
    }
  }

  async function uploadAll(files: File[], pos?: number) {
    setBusy(true);
    const epoch = uploadEpoch;
    const job = (async () => {
      for (const f of files) {
        // Never send a queued file after sign-out (the next request would carry another
        // user's session) or after the note was closed.
        if (epoch !== uploadEpoch || closed.current) return;
        await uploadOne(f, pos);
      }
    })();
    pendingUploads.set(job, epoch);
    try {
      await job;
    } finally {
      pendingUploads.delete(job);
      setBusy(false);
    }
  }

  /** For paste/drop handlers: returns true if it took the event. */
  function handleFiles(list: FileList | null | undefined, pos?: number): boolean {
    const files = list ? Array.from(list).filter((f) => f.type.startsWith('image/')) : [];
    if (files.length === 0) return false;
    void uploadAll(files, pos);
    return true;
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT.join(',')}
      hidden
      onChange={(e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = '';
        if (files.length) void uploadAll(files);
      }}
    />
  );

  return { busy, input, pick: () => inputRef.current?.click(), handleFiles };
}
