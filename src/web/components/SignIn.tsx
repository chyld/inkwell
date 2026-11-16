import { useState } from 'react';
import { api, ApiError, setExpectedUser, type Me } from '../api';

export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>('POST', '/session', { username, password }, { noAuthRedirect: true });
      setExpectedUser(s.id); // this tab is now signed in as this user
      const me = await api<Me>('GET', '/me');
      onSignedIn(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <h1>Notes</h1>
        <label className="field">
          <span>Username</span>
          <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
