// The tags in the title row: each a chip with a remove cross; a box to add more (Enter, a comma or leaving it),
// suggesting the user's other tags; Backspace in the empty box removes the last tag.
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { TagCount } from '../api';
import { normalizeTag, TAGS_PER_NOTE } from '../../shared/noteRules';
import { useDialogs } from './Dialogs';

export function TagEditor({ tags, allTags, readOnly, onChange }: { tags: string[]; allTags: TagCount[]; readOnly: boolean; onChange: (t: string[]) => void }) {
  const [value, setValue] = useState('');
  const dialogs = useDialogs();
  const listId = useMemo(() => `tags-${Math.random().toString(36).slice(2)}`, []);
  function add(raw: string) {
    const t = normalizeTag(raw);
    setValue('');
    if (!t) {
      if (raw.trim()) dialogs.notice('A tag is 1-50 characters and cannot contain commas.');
      return;
    }
    if (tags.includes(t)) return;
    if (tags.length >= TAGS_PER_NOTE) {
      dialogs.notice(`A note can have at most ${TAGS_PER_NOTE} tags.`);
      return;
    }
    onChange([...tags, t]);
  }
  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          {!readOnly && (
            <button className="chip-x" aria-label={`Remove tag ${t}`} title={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <>
          <input
            className="tag-input"
            placeholder={tags.length ? 'Add tag' : 'Add tags'}
            aria-label="Add tag"
            list={listId}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(',')) v.split(',').forEach((p, i, a) => (i < a.length - 1 ? add(p) : setValue(p)));
              else setValue(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(value);
              } else if (e.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1));
            }}
            onBlur={() => value.trim() && add(value)}
          />
          <datalist id={listId}>
            {allTags
              .filter((t) => !tags.includes(t.name))
              .map((t) => (
                <option key={t.name} value={t.name} />
              ))}
          </datalist>
        </>
      )}
    </div>
  );
}
