import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FolderNode } from '../api';

type Pending =
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void }
  | { kind: 'choose'; title: string; message: string; options: { label: string; value: string; primary?: boolean }[]; resolve: (v: string | null) => void }
  | {
      kind: 'folder';
      title: string;
      folders: FolderNode[];
      disabled: (f: FolderNode) => boolean;
      rootLabel: string | null;
      current: string | null | undefined;
      resolve: (v: { id: string | null } | null) => void;
    };

export interface DialogApi {
  confirm(o: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  prompt(o: { title: string; label: string; initial?: string; confirmLabel?: string }): Promise<string | null>;
  choose(o: { title: string; message: string; options: { label: string; value: string; primary?: boolean }[] }): Promise<string | null>;
  pickFolder(o: {
    title: string;
    folders: FolderNode[];
    disabled?: (f: FolderNode) => boolean;
    rootLabel?: string | null;
    current?: string | null;
  }): Promise<{ id: string | null } | null>;
  notice(message: string): void;
}

const Ctx = createContext<DialogApi | null>(null);
export const useDialogs = () => useContext(Ctx)!;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const seq = useRef(0);

  const apiRef = useRef<DialogApi>({
    confirm: (o) => new Promise((resolve) => setPending({ kind: 'confirm', confirmLabel: 'OK', danger: false, ...o, resolve })),
    prompt: (o) => new Promise((resolve) => setPending({ kind: 'prompt', initial: '', confirmLabel: 'OK', ...o, resolve })),
    choose: (o) => new Promise((resolve) => setPending({ kind: 'choose', ...o, resolve })),
    pickFolder: (o) =>
      new Promise((resolve) =>
        setPending({ kind: 'folder', disabled: () => false, rootLabel: null, current: undefined, ...o, resolve }),
      ),
    notice: (text) => {
      const id = ++seq.current;
      setNotices((n) => [...n, { id, text }]);
      setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 7000);
    },
  });

  const close = useCallback(() => setPending(null), []);

  return (
    <Ctx.Provider value={apiRef.current}>
      {children}
      {pending && <Modal pending={pending} close={close} />}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className="notice">
            {n.text}
            <button className="link-button" onClick={() => setNotices((x) => x.filter((y) => y.id !== n.id))} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Modal({ pending, close }: { pending: Pending; close: () => void }) {
  const [value, setValue] = useState(pending.kind === 'prompt' ? pending.initial : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancel = () => {
    if (pending.kind === 'confirm') pending.resolve(false);
    else pending.resolve(null);
    close();
  };
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">{pending.title}</h2>
        {pending.kind === 'confirm' && (
          <>
            <p>{pending.message}</p>
            <div className="modal-actions">
              <button onClick={cancel}>Cancel</button>
              <button
                className={pending.danger ? 'danger' : 'primary'}
                autoFocus
                onClick={() => {
                  pending.resolve(true);
                  close();
                }}
              >
                {pending.confirmLabel}
              </button>
            </div>
          </>
        )}
        {pending.kind === 'prompt' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pending.resolve(value);
              close();
            }}
          >
            <label className="field">
              <span>{pending.label}</span>
              <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={cancel}>
                Cancel
              </button>
              <button type="submit" className="primary">
                {pending.confirmLabel}
              </button>
            </div>
          </form>
        )}
        {pending.kind === 'choose' && (
          <>
            <p>{pending.message}</p>
            <div className="modal-actions">
              {pending.options.map((o) => (
                <button
                  key={o.value}
                  className={o.primary ? 'primary' : ''}
                  onClick={() => {
                    pending.resolve(o.value);
                    close();
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
        {pending.kind === 'folder' && (
          <>
            <div className="folder-picker">
              {pending.rootLabel !== null && (
                <button
                  className={'picker-row' + (pending.current === null ? ' current' : '')}
                  onClick={() => {
                    pending.resolve({ id: null });
                    close();
                  }}
                >
                  {pending.rootLabel}
                </button>
              )}
              <PickerTree
                folders={pending.folders}
                depth={0}
                disabled={pending.disabled}
                current={pending.current}
                pick={(id) => {
                  pending.resolve({ id });
                  close();
                }}
              />
            </div>
            <div className="modal-actions">
              <button onClick={cancel}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PickerTree({
  folders,
  depth,
  disabled,
  current,
  pick,
}: {
  folders: FolderNode[];
  depth: number;
  disabled: (f: FolderNode) => boolean;
  current: string | null | undefined;
  pick: (id: string) => void;
}) {
  return (
    <>
      {folders.map((f) => (
        <div key={f.id}>
          <button
            className={'picker-row' + (current === f.id ? ' current' : '')}
            style={{ paddingLeft: 12 + depth * 18 }}
            disabled={disabled(f)}
            onClick={() => pick(f.id)}
          >
            {f.isInbox ? '📥 ' : '📁 '}
            {f.name}
          </button>
          {f.children.length > 0 && <PickerTree folders={f.children} depth={depth + 1} disabled={disabled} current={current} pick={pick} />}
        </div>
      ))}
    </>
  );
}
