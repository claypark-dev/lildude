import { useState, useEffect, useRef, useCallback } from 'react';
import type { WsIncomingMessage, WsOutgoingMessage } from '../lib/types.ts';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:18421/ws';
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
        ws.send(JSON.stringify({ type: 'subscribe', payload: { topics: ['tasks', 'messages', '*'] } }));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const envelope = JSON.parse(String(event.data)) as {
            type: string;
            payload: Record<string, unknown>;
            timestamp: string;
          };
          // Map server envelope format to the flat WsIncomingMessage format
          const mapped = mapServerMessage(envelope);
          if (mapped) {
            setLastMessage(mapped);
          }
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
      // Wrap outgoing messages in the server's expected envelope format
      const envelope = mapOutgoingMessage(message);
      wsRef.current.send(JSON.stringify(envelope));
    }
  }, []);

  return { connected, lastMessage, send };
}

/** Map a server envelope to the flat WsIncomingMessage format used by the UI */
function mapServerMessage(
  envelope: { type: string; payload: Record<string, unknown> },
): WsIncomingMessage | null {
  switch (envelope.type) {
    case 'chat.message':
      return {
        type: 'message',
        text: String(envelope.payload.text ?? ''),
        role: 'assistant',
      };
    case 'chat.stream':
      return { type: 'stream_chunk', text: String(envelope.payload.text ?? '') };
    case 'stream_end':
      return { type: 'stream_end' };
    case 'task.update':
      return {
        type: 'task_update',
        task: envelope.payload.task as WsIncomingMessage extends { type: 'task_update'; task: infer T } ? T : never,
      };
    default:
      return null;
  }
}

/** Map an outgoing UI message to the server's expected envelope format */
function mapOutgoingMessage(message: WsOutgoingMessage): Record<string, unknown> {
  if (message.type === 'chat') {
    return {
      type: 'chat.send',
      payload: { text: message.text },
      timestamp: new Date().toISOString(),
    };
  }
  if (message.type === 'subscribe') {
    return {
      type: 'subscribe',
      payload: { topics: message.channels },
      timestamp: new Date().toISOString(),
    };
  }
  return message;
}
