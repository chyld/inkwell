export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export class NetworkError extends Error {}

let unauthorizedHandler: () => void = () => {};
export function setUnauthorizedHandler(f: () => void) {
  unauthorizedHandler = f;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData; noAuthRedirect?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: opts.form ? {} : body !== undefined ? { 'content-type': 'application/json' } : {},
      body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new NetworkError('Could not reach the server.');
  }
  let data: any = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const e = data?.error ?? {};
    const { code, message, ...extra } = e;
    if (res.status === 401 && !opts.noAuthRedirect) unauthorizedHandler();
    throw new ApiError(res.status, code ?? 'http_' + res.status, message ?? `The server answered ${res.status}.`, extra);
  }
  return data as T;
}

export interface Me {
  id: string;
  username: string;
  storageUsed: number;
  storageLimit: number;
  inboxId: string;
}
export interface Origin {
  type: 'user' | 'agent';
  name?: string;
}
export interface NoteItem {
  id: string;
  title: string;
  snippet: string;
  folderId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  origin: Origin;
}
export interface Note extends Omit<NoteItem, 'snippet'> {
  body: any;
  version: number;
}
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  isInbox: boolean;
  noteCount: number;
  children: FolderNode[];
}
export interface TagCount {
  name: string;
  count: number;
}
