import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { httpRequest } from '../../../src/tools/api.js';
import { getRecentSecurityLogs } from '../../../src/persistence/security-log.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('api tool', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('domain blocking', () => {
    it('blocks requests to localhost', async () => {
      const result = await httpRequest(db, 'http://localhost:3000/api', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
      expect(result.metadata?.hostname).toBe('localhost');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(false);
      expect(logs[0].actionType).toBe('http_request');
    });

    it('blocks requests to 127.0.0.1', async () => {
      const result = await httpRequest(db, 'http://127.0.0.1:8080/data', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks requests to 0.0.0.0', async () => {
      const result = await httpRequest(db, 'http://0.0.0.0/admin', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks requests to private network 10.x.x.x', async () => {
      const result = await httpRequest(db, 'http://10.0.0.1/internal', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks requests to private network 192.168.x.x', async () => {
      const result = await httpRequest(db, 'http://192.168.1.1/router', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks requests to .internal domains', async () => {
      const result = await httpRequest(db, 'http://api.internal/secret', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });
  });

  describe('security level enforcement', () => {
    it('blocks all network at security level 1', async () => {
      const result = await httpRequest(db, 'https://api.github.com/repos', 'GET', 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
      expect(result.error).toContain('level 1');
    });

    it('requires approval for non-allowlisted domains at level 2-3', async () => {
      const result = await httpRequest(db, 'https://example.com/api', 'GET', 3);

      expect(result.success).toBe(false);
      expect(result.error).toContain('approval');
      expect(result.metadata?.needsApproval).toBe(true);
    });

    it('allows non-allowlisted domains at level 4-5', async () => {
      // Mock fetch to avoid real network calls
      const mockResponse = new Response('{"ok": true}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(db, 'https://example.com/api', 'GET', 4);

      expect(result.success).toBe(true);
      expect(result.metadata?.statusCode).toBe(200);
    });
  });

  describe('allowed domains', () => {
    it('allows requests to api.github.com at level 3 with mocked fetch', async () => {
      const mockResponse = new Response('{"repos": []}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(db, 'https://api.github.com/repos', 'GET', 3);

      expect(result.success).toBe(true);
      expect(result.output).toBe('{"repos": []}');
      expect(result.metadata?.statusCode).toBe(200);

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].actionType).toBe('http_request');
    });

    it('allows POST requests with body to allowed domain', async () => {
      const mockResponse = new Response('{"created": true}', {
        status: 201,
        statusText: 'Created',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(
        db,
        'https://api.github.com/issues',
        'POST',
        3,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ title: 'Test issue' }),
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.statusCode).toBe(201);
    });
  });

  describe('error handling', () => {
    it('handles invalid URL gracefully', async () => {
      const result = await httpRequest(db, 'not-a-valid-url', 'GET', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('handles fetch failure gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await httpRequest(db, 'https://api.github.com/repos', 'GET', 3);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');

      // Should still log the attempt
      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true); // Allowed but failed
    });

    it('handles non-OK HTTP responses', async () => {
      const mockResponse = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(db, 'https://api.github.com/nonexistent', 'GET', 3);

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
      expect(result.metadata?.statusCode).toBe(404);
    });

    it('handles timeout via AbortError', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

      const result = await httpRequest(db, 'https://api.github.com/slow', 'GET', 3);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.metadata?.timedOut).toBe(true);
    });
  });

  describe('audit logging', () => {
    it('logs denied requests with correct details', async () => {
      await httpRequest(db, 'http://localhost:3000/api', 'GET', 5, undefined, undefined, 'task-api-1');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].actionType).toBe('http_request');
      expect(logs[0].actionDetail).toBe('GET http://localhost:3000/api');
      expect(logs[0].allowed).toBe(false);
      expect(logs[0].securityLevel).toBe(5);
      expect(logs[0].taskId).toBe('task-api-1');
    });

    it('logs successful requests with status code', async () => {
      const mockResponse = new Response('ok', { status: 200, statusText: 'OK' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await httpRequest(db, 'https://api.github.com/health', 'GET', 3, undefined, undefined, 'task-api-2');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].reason).toContain('200');
      expect(logs[0].taskId).toBe('task-api-2');
    });
  });

  describe('HTTP methods', () => {
    it('supports PUT requests', async () => {
      const mockResponse = new Response('updated', { status: 200, statusText: 'OK' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(
        db,
        'https://api.github.com/resource/1',
        'PUT',
        3,
        { 'Content-Type': 'application/json' },
        '{"key": "value"}',
      );

      expect(result.success).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.github.com/resource/1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('supports DELETE requests', async () => {
      const mockResponse = new Response(null, { status: 204, statusText: 'No Content' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await httpRequest(db, 'https://api.github.com/resource/1', 'DELETE', 3);

      expect(result.success).toBe(true);
      expect(result.metadata?.statusCode).toBe(204);
    });
  });
});
