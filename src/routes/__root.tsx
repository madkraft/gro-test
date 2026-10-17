import { useQueryClient } from "@tanstack/react-query";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { GROCERY_QUERY_KEY } from "../hooks/useGroceryList";
import { useGrocerySyncing } from "../hooks/useGrocerySyncing";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export const Route = createRootRoute({
  component: RootLayout,
});

async function hardReloadApp() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* still try reload */
  }
  window.location.reload();
}

function RootLayout() {
  const isOnline = useOnlineStatus();
  const isSyncing = useGrocerySyncing();
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: GROCERY_QUERY_KEY });

  // iOS only runs shortcuts from the web by switching to the Shortcuts app; refetch once the user comes back.
  const syncReminders = () => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onReturn);
      refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.location.href = "shortcuts://run-shortcut?name=GroSync";
  };

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="masthead__title">Zakupy!</h1>
        <p className="masthead__meta">
          {isOnline ? null : <span className="masthead__offline">● offline</span>}
          {isSyncing ? <span aria-live="polite">saving…</span> : null}
        </p>
        <nav className="toolbar" aria-label="Sync">
          <button type="button" className="toolbar__btn" disabled={isSyncing} onClick={refresh}>
            Refresh
          </button>
          <button
            type="button"
            className="toolbar__btn"
            title="Sync with Apple Reminders (runs the GroSync shortcut)"
            onClick={syncReminders}
          >
            Sync Reminders
          </button>
          <button
            type="button"
            className="toolbar__btn"
            title="Unregister service worker, clear caches, reload (fixes stale PWA)"
            onClick={() => void hardReloadApp()}
          >
            Hard reload
          </button>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
