import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isOnline = useOnlineStatus();

  return (
    <div className="shell">
      <header className="shell__nav">
        <Link
          to="/input"
          className="shell__link"
          activeProps={{ className: "shell__link shell__link--active" }}
          inactiveProps={{ className: "shell__link" }}
        >
          DODAJ
        </Link>
        <span className="shell__sep">·</span>
        <Link
          to="/list"
          className="shell__link"
          activeProps={{ className: "shell__link shell__link--active" }}
          inactiveProps={{ className: "shell__link" }}
        >
          LISTA
        </Link>
        {isOnline ? null : (
          <span className="shell__offline" aria-live="polite">
            offline
          </span>
        )}
      </header>
      <Outlet />
    </div>
  );
}
