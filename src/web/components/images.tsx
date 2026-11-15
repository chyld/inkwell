import { useRef, useState, type MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { api, ApiError } from '../api';
import type { DialogApi } from './Dialogs';

const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX = 10 * 1024 * 1024;

/** Upload button, paste and drop for images (SPEC 6.5). */
export function useImageUpload(editorRef: MutableRefObject<Editor | null>, dialogs: DialogApi, onStorageChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File, pos?: number) {
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
    try {
      const r = await api<{ id: string; src: string }>('POST', '/images', undefined, { form });
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      const node = { type: 'image', attrs: { src: r.src, alt: file.name.replace(/\.[a-z0-9]+$/i, '') } };
      if (pos !== undefined) ed.chain().focus().insertContentAt(pos, node).run();
      else ed.chain().focus().insertContent(node).run();
      onStorageChanged();
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? `Image not added: ${e.message}` : 'Image not added: the server could not be reached.');
    }
  }

  async function uploadAll(files: File[], pos?: number) {
    setBusy(true);
    try {
      for (const f of files) await uploadOne(f, pos);
    } finally {
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
