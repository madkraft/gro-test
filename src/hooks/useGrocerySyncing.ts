import { useIsFetching } from "@tanstack/react-query";
import { useOnlineStatus } from "./useOnlineStatus";

const QUERY_KEY = ["grocery-items"] as const;

/** True while the grocery list query is refetching (shared with useGroceryList). */
export function useGrocerySyncing(): boolean {
  const isOnline = useOnlineStatus();
  const fetching = useIsFetching({ queryKey: QUERY_KEY });
  return isOnline && fetching > 0;
}
