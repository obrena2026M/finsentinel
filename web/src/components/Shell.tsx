import { type ReactNode, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

// Global shell (UX §2): top bar, left nav, main, right context panel.

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

  const switchUser = async () => {
    setMenu(false);
    await logout();
    navigate('/signin');
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/cases" className="brand">
          <span className="brand-name">FinSentinel</span>
          <span className="brand-sub">Financial Crime Risk Assessment Workbench</span>
        </Link>
        <span className="chip chip-neutral small" title="Synthetic environment">
          Synthetic data · simulation sign-in
        </span>
        <span className="topbar-spacer" />
        {me && (
          <>
            <span className="chip role-badge" data-testid="role-badge">
              <span className="chip-icon" aria-hidden="true">
                ●
              </span>
              {me.role_label}
            </span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setMenu((m) => !m)}
                aria-haspopup="menu"
                aria-expanded={menu}
                data-testid="user-menu"
              >
                {me.display_name} ▾
              </button>
              {menu && (
                <div
                  role="menu"
                  className="card"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '110%',
                    minWidth: 200,
                    zIndex: 20,
                    padding: 8,
                  }}
                >
                  <div className="small muted" style={{ padding: '4px 8px' }}>
                    {me.username}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', border: 0 }}
                    onClick={switchUser}
                    data-testid="switch-user"
                  >
                    ⇄ Switch user
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        <ThemeToggle />
      </header>
      <nav className="sidenav" aria-label="Primary">
        <NavLink to="/cases">Cases</NavLink>
        <NavLink to="/quality">Quality Center</NavLink>
        <NavLink to="/ops">Ops</NavLink>
        {me?.role === 'admin' && <NavLink to="/admin/risk-model">Admin</NavLink>}
      </nav>
      <div className="main-with-panel">
        <main className="main">{children}</main>
        <ContextPanel />
      </div>
    </div>
  );
}
