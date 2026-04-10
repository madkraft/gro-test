import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useOnlineStatus } from "./useOnlineStatus";

const QUERY_KEY = ["grocery-items"] as const;

/** True while the grocery list is fetching from or writing to the server. */
export function useGrocerySyncing(): boolean {
  const isOnline = useOnlineStatus();
  const fetching = useIsFetching({ queryKey: QUERY_KEY });
  const mutating = useIsMutating();
  return isOnline && (fetching > 0 || mutating > 0);
}
