import { useTheme } from '../theme.ts';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-theme-current={theme}
    >
      <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span> {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
