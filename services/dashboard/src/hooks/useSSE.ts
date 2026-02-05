import { useEffect, useRef, useCallback } from "react";
import { baseUrl } from "@/api/stats";

export interface PriceUpdate {
  walletId: number;
  priceUsd: number;
  recordedAt: string;
}

interface UseSSEOptions {
  onPriceUpdate?: (data: PriceUpdate) => void;
  onConnected?: (clientId: string) => void;
  onDisconnected?: () => void;
  reconnectDelay?: number;
}

export function useSSE(options: UseSSEOptions = {}) {
  const {
    onPriceUpdate,
    onConnected,
    onDisconnected,
    reconnectDelay = 3000
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`${baseUrl}/api/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("connected", (e) => {
      isConnectedRef.current = true;
      try {
        const data = JSON.parse(e.data);
        onConnected?.(data.clientId);
      } catch {
        onConnected?.("unknown");
      }
    });

    eventSource.addEventListener("price_update", (e) => {
      try {
        const data: PriceUpdate = JSON.parse(e.data);
        onPriceUpdate?.(data);
      } catch (err) {
        console.error("Failed to parse price_update event:", err);
      }
    });

    eventSource.onerror = () => {
      isConnectedRef.current = false;
      onDisconnected?.();
      eventSource.close();
      eventSourceRef.current = null;

      // Reconnect after delay
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, reconnectDelay);
    };
  }, [onPriceUpdate, onConnected, onDisconnected, reconnectDelay]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  return {
    isConnected: isConnectedRef.current
  };
}
