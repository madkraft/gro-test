import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { useGrocerySyncing } from "../hooks/useGrocerySyncing";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isOnline = useOnlineStatus();
  const isSyncing = useGrocerySyncing();

  return (
    <div className="shell">
      <header className="shell__nav">
        <div className="shell__nav-links">
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
        </div>
        <div className="shell__nav-end">
          {isSyncing ? (
            <span className="shell__sync" aria-live="polite">
              Syncing…
            </span>
          ) : null}
          {isOnline ? null : (
            <span className="shell__offline" aria-live="polite">
              offline
            </span>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}
