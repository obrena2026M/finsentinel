import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ErrorText, Loading } from '../components/common.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { UserTile } from '../components/UserTile.tsx';
import type { AuthUser } from '../types.ts';

// Simulation sign-in (UX §4.1): role tiles + dropdown, no password.

export function SignInPage() {
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const { setMe } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .users()
      .then(setUsers)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const signIn = async (username: string) => {
    if (!username) return;
    setBusy(true);
    setError(null);
    try {
      const me = await api.login(username);
      setMe(me);
      navigate('/cases');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-head">
        <div>
          <h1 style={{ fontSize: '2rem' }}>FinSentinel</h1>
          <div className="muted">Financial Crime Risk Assessment Workbench</div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Synthetic environment — no real data · Simulation sign-in (no password)
          </div>
        </div>
        <ThemeToggle />
      </div>
      <h2 style={{ alignSelf: 'flex-start', width: 'min(900px, 100%)', margin: '0 auto 14px' }}>
        Choose who you are for this session
      </h2>
      <ErrorText error={error} />
      {!users && !error && <Loading what="Loading users" />}
      {users && (
        <>
          <div className="tiles">
            {users.map((u) => (
              <UserTile key={u.username} user={u} onSelect={signIn} busy={busy} />
            ))}
          </div>
          <form
            className="row"
            style={{ marginTop: 26, width: 'min(900px, 100%)' }}
            onSubmit={(e) => {
              e.preventDefault();
              void signIn(selected);
            }}
          >
            <label htmlFor="user-select" className="muted">
              Or pick from list:
            </label>
            <select
              id="user-select"
              className="select"
              style={{ width: 320 }}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              data-testid="user-select"
            >
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.display_name} — {u.role_label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selected || busy}
              data-testid="user-select-continue"
            >
              Continue
            </button>
            {!selected && <span className="btn-reason">Select a user first</span>}
          </form>
        </>
      )}
    </div>
  );
}
