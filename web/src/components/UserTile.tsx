import type { AuthUser, Role } from '../types.ts';

const ICON: Record<Role, string> = { product_owner: '👤', analyst: '🔎', committee: '⚖', admin: '⚙' };

export function UserTile({
  user,
  onSelect,
  busy,
}: {
  user: AuthUser;
  onSelect: (username: string) => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      className="user-tile"
      data-testid={`tile-${user.username}`}
      onClick={() => onSelect(user.username)}
      disabled={busy}
    >
      <div className="tile-name">
        <span aria-hidden="true">{ICON[user.role] ?? '👤'}</span> {user.display_name}
      </div>
      <div className="tile-role">{user.role_label}</div>
      <div className="tile-desc">{user.role_description}</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="btn btn-primary btn-sm">Continue →</span>
      </div>
    </button>
  );
}
