// @vitest-environment happy-dom
// Criterion 3, editor side: the Tiptap editor, built from the same schema
// module, loads a stored note with every element without losing anything.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { noteExtensions, validateBody } from '../src/shared/schema.js';
import { fullDoc } from './fixtures/full-note.js';

describe('editor round trip', () => {
  it('getJSON() after loading equals the stored document', () => {
    const stored = validateBody(fullDoc('/api/images/0b5c3a1e-7f2d-4c4e-9a7b-2d1f0e9c8b7a')).json;
    const editor = new Editor({ extensions: noteExtensions, content: stored });
    expect(editor.getJSON()).toEqual(stored);
    // And what the editor produces passes server validation unchanged.
    expect(validateBody(editor.getJSON()).json).toEqual(stored);
    editor.destroy();
  });

  it('pasted HTML cannot bring in external images, scripts or javascript: links', () => {
    const editor = new Editor({ extensions: noteExtensions, content: '' });
    editor.commands.insertContent(
      '<p>hi <a href="javascript:alert(1)">bad</a> <a href="https://ok.example">good</a></p><img src="https://evil.example/x.png"><script>alert(1)</script><table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    const json = editor.getJSON();
    const s = JSON.stringify(json);
    expect(s).not.toContain('javascript:');
    expect(s).not.toContain('evil.example');
    expect(s).not.toContain('"colspan":2');
    expect(s).toContain('https://ok.example');
    expect(() => validateBody(json)).not.toThrow();
    editor.destroy();
  });
});
