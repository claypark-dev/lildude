import { useState, useEffect, useRef, useCallback } from 'react';
import type { WsIncomingMessage, WsOutgoingMessage } from '../lib/types.ts';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws';
const RECONNECT_DELAY_MS = 3000;

interface UseWebSocketResult {
  connected: boolean;
  lastMessage: WsIncomingMessage | null;
  send: (message: WsOutgoingMessage) => void;
}

/**
 * Hook for managing a WebSocket connection with auto-reconnect.
 * Connects on mount, reconnects on disconnect, and provides send/receive.
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsIncomingMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'subscribe', channels: ['tasks', 'messages'] }));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(event.data)) as WsIncomingMessage;
          setLastMessage(parsed);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: WsOutgoingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, lastMessage, send };
}
