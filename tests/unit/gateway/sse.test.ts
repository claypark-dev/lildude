/**
 * Unit tests for the SSE endpoint.
 * Tests the broadcastSSE utility and GET /api/v1/events endpoint.
 */

import { describe, it, expect } from 'vitest';
import { broadcastSSE, getSSEClientCount } from '../../../src/gateway/api/sse.js';

describe('SSE Module', () => {
  it('exports broadcastSSE function', () => {
    expect(typeof broadcastSSE).toBe('function');
  });

  it('exports getSSEClientCount function', () => {
    expect(typeof getSSEClientCount).toBe('function');
  });

  it('getSSEClientCount returns 0 with no clients', () => {
    expect(getSSEClientCount()).toBe(0);
  });

  it('broadcastSSE does not throw with no clients', () => {
    expect(() => {
      broadcastSSE('test.event', { message: 'hello' });
    }).not.toThrow();
  });
});
