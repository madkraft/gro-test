import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { fetchGroceryItems, postGroceryItems } from "../lib/grocery-api";
import { getItems, mergeItems, setItems } from "../lib/storage";
import type { GroceryItem } from "../types/grocery";
import { useOnlineStatus } from "./useOnlineStatus";

const QUERY_KEY = ["grocery-items"] as const;

export function useGroceryList(): {
  items: GroceryItem[];
  updateList: (next: GroceryItem[]) => void;
  isOnline: boolean;
} {
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const server = await fetchGroceryItems();
      const local = getItems();
      const merged = mergeItems(local, server);
      setItems(merged);
      if (JSON.stringify(merged) !== JSON.stringify(server)) {
        try {
          await postGroceryItems(merged);
        } catch (e) {
          console.warn("Cloud sync after merge failed:", e);
        }
      }
      return merged;
    },
    initialData: getItems(),
    enabled: isOnline,
  });

  useEffect(() => {
    const onOnline = () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queryClient]);

  const updateList = useCallback(
    (next: GroceryItem[]) => {
      setItems(next);
      queryClient.setQueryData(QUERY_KEY, next);
      if (typeof navigator !== "undefined" && navigator.onLine) {
        void postGroceryItems(next).catch((e) => {
          console.warn("Cloud sync failed:", e);
        });
      }
    },
    [queryClient],
  );

  const items = isOnline ? (query.data ?? getItems()) : getItems();

  return {
    items,
    updateList,
    isOnline,
  };
}
