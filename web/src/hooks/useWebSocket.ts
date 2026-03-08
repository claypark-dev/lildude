import { useState, useEffect, useRef, useCallback } from 'react';
import type { WsIncomingMessage, WsOutgoingMessage } from '../lib/types.ts';
import { getStoredApiKey, fetchOnboardingStatus } from '../lib/api.ts';

/** Derive WS URL from the current page origin to avoid cross-origin issues. */
const WS_URL = import.meta.env.VITE_WS_URL
  ?? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const RECONNECT_DELAY_MS = 3000;

interface UseWebSocketResult {
  connected: boolean;
  lastMessage: WsIncomingMessage | null;
  send: (message: WsOutgoingMessage) => void;
}

/**
 * Hook for managing a WebSocket connection with auto-reconnect.
 * Connects on mount, reconnects on disconnect, and provides send/receive.
 *
 * Auth flow:
 * 1. Ensure a fresh API key exists (fetch from /onboarding/status if needed)
 * 2. Open WebSocket and send auth message as the first frame
 * 3. Wait for 'auth.ok' before marking as connected
 * 4. On 'auth.failed', force-refresh the API key and reconnect once
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsIncomingMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track whether we already retried with a fresh key to avoid infinite loops. */
  const authRetried = useRef(false);

  const connect = useCallback(async () => {
    // Ensure we have an API key before connecting.
    let apiKey = getStoredApiKey();
    if (!apiKey) {
      try {
        await fetchOnboardingStatus(true);
        apiKey = getStoredApiKey();
      } catch {
        // Server may not be up yet — retry after delay
        reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
        return;
      }
    }

    if (!apiKey) {
      // Still no key — retry later
      reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        // Authenticate first — WS server requires auth as the first message
        const key = getStoredApiKey();
        if (key) {
          ws.send(JSON.stringify({ type: 'auth', token: key }));
        }
        // Do NOT set connected here — wait for auth.ok response
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const envelope = JSON.parse(String(event.data)) as {
            type: string;
            payload: Record<string, unknown>;
            timestamp: string;
          };

          // ── Auth response handling ──
          if (envelope.type === 'auth.ok') {
            setConnected(true);
            authRetried.current = false;
            // Now that we're authenticated, subscribe and request history
            ws.send(JSON.stringify({
              type: 'subscribe',
              payload: { topics: ['tasks', 'messages', '*'] },
            }));
            ws.send(JSON.stringify({
              type: 'chat.history',
              payload: { limit: 50 },
              timestamp: new Date().toISOString(),
            }));
            return;
          }

          if (envelope.type === 'auth.failed') {
            setConnected(false);
            // Suppress normal onclose reconnect — we handle it here
            ws.onclose = null;
            ws.close();
            wsRef.current = null;

            if (!authRetried.current) {
              // First failure: force-refresh the API key (skip auth header) then reconnect
              authRetried.current = true;
              void fetchOnboardingStatus(true)
                .then(() => { void connect(); })
                .catch(() => {
                  reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
                });
            } else {
              // Already retried once — schedule a delayed reconnect
              reconnectTimerRef.current = setTimeout(() => {
                authRetried.current = false;
                void connect();
              }, RECONNECT_DELAY_MS * 2);
            }
            return;
          }

          // ── Normal message handling ──
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
        reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    void connect();

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
    case 'chat.history':
      return {
        type: 'history',
        messages: (envelope.payload.messages ?? []) as Array<{ id: string; text: string; role: string; timestamp: number }>,
      };
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
