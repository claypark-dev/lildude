import { useState, useEffect, useRef } from 'react';
import { getStoredApiKey } from '../lib/api.ts';

/** SSE event received from the server. */
export interface SSEEvent {
  event: string;
  data: unknown;
  timestamp: Date;
}

interface UseSSEResult {
  connected: boolean;
  lastEvent: SSEEvent | null;
  events: SSEEvent[];
}

/**
 * Hook for connecting to the SSE events endpoint.
 * Auto-reconnects on disconnect.
 * @param maxEvents - Maximum number of events to retain (default: 50).
 */
export function useSSE(maxEvents = 50): UseSSEResult {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
    const apiKey = getStoredApiKey();
    const url = `${baseUrl}/api/v1/events${apiKey ? `?token=${encodeURIComponent(apiKey)}` : ''}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
    };

    // Listen for specific event types
    const eventTypes = ['connected', 'cron.fired', 'task.update', 'cost.update', 'health.update'];

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const sseEvent: SSEEvent = {
            event: eventType,
            data,
            timestamp: new Date(),
          };
          setLastEvent(sseEvent);
          setEvents((prev) => [sseEvent, ...prev].slice(0, maxEvents));
        } catch {
          // Ignore parse errors
        }
      });
    }

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [maxEvents]);

  return { connected, lastEvent, events };
}
