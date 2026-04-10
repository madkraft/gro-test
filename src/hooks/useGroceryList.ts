import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchGroceryItems, postGroceryItems } from "../lib/grocery-api";
import { getItems, mergeItems } from "../lib/storage";
import type { GroceryItem } from "../types/grocery";
import { useOnlineStatus } from "./useOnlineStatus";

export const GROCERY_QUERY_KEY = ["grocery-items"] as const;

export function useGroceryList(): {
  items: GroceryItem[];
  updateList: (next: GroceryItem[]) => void;
  isOnline: boolean;
} {
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: GROCERY_QUERY_KEY,
    queryFn: async () => {
      const server = await fetchGroceryItems();
      const cached =
        queryClient.getQueryData<GroceryItem[]>(GROCERY_QUERY_KEY) ?? [];
      const merged = mergeItems(cached, server);
      if (JSON.stringify(merged) !== JSON.stringify(server)) {
        try {
          await postGroceryItems(merged);
        } catch (e) {
          console.warn("Cloud sync after merge failed:", e);
        }
      }
      return merged;
    },
    // One-time migration: seed the cache from the old localStorage key if
    // TanStack's own persisted cache is empty (e.g. first run after upgrade).
    initialData: getItems,
  });

  const mutation = useMutation({
    mutationFn: postGroceryItems,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: GROCERY_QUERY_KEY });
      const previous =
        queryClient.getQueryData<GroceryItem[]>(GROCERY_QUERY_KEY);
      queryClient.setQueryData(GROCERY_QUERY_KEY, next);
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(GROCERY_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GROCERY_QUERY_KEY });
    },
  });

  const updateList = useCallback(
    (next: GroceryItem[]) => {
      mutation.mutate(next);
    },
    [mutation],
  );

  return {
    items: query.data ?? [],
    updateList,
    isOnline,
  };
}
