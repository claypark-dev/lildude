/**
 * Tests for the Gmail API wrapper module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listEmails,
  sendEmail,
  EmailListParamsSchema,
  EmailSendParamsSchema,
} from '../../../src/integrations/gmail.js';

describe('Gmail Integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('EmailListParamsSchema', () => {
    it('applies defaults for missing optional fields', () => {
      const result = EmailListParamsSchema.parse({});
      expect(result.maxResults).toBe(20);
      expect(result.unreadOnly).toBe(false);
    });

    it('accepts valid params', () => {
      const result = EmailListParamsSchema.parse({
        maxResults: 5,
        query: 'from:test@example.com',
        unreadOnly: true,
      });
      expect(result.maxResults).toBe(5);
      expect(result.query).toBe('from:test@example.com');
      expect(result.unreadOnly).toBe(true);
    });

    it('rejects maxResults > 100', () => {
      const result = EmailListParamsSchema.safeParse({ maxResults: 200 });
      expect(result.success).toBe(false);
    });
  });

  describe('EmailSendParamsSchema', () => {
    it('validates required fields', () => {
      const result = EmailSendParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts valid send params', () => {
      const result = EmailSendParamsSchema.parse({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Test body',
      });
      expect(result.to).toBe('user@example.com');
      expect(result.subject).toBe('Hello');
    });

    it('accepts optional cc and bcc', () => {
      const result = EmailSendParamsSchema.parse({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Body',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
      });
      expect(result.cc).toBe('cc@example.com');
      expect(result.bcc).toBe('bcc@example.com');
    });
  });

  describe('listEmails', () => {
    it('returns empty array when no messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [], resultSizeEstimate: 0 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEmails('test-token', {
        maxResults: 10,
        unreadOnly: false,
      });

      expect(result.success).toBe(true);
      expect(result.emails).toEqual([]);
    });

    it('fetches and formats email summaries', async () => {
      const mockFetch = vi.fn()
        // First call: list messages
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            messages: [{ id: 'msg1', threadId: 'thread1' }],
          }),
        })
        // Second call: get message details
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'msg1',
            threadId: 'thread1',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Hey there, just checking in...',
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Checking In' },
                { name: 'Date', value: 'Mon, 3 Mar 2026 10:00:00 -0500' },
              ],
            },
          }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEmails('test-token', {
        maxResults: 10,
        unreadOnly: false,
      });

      expect(result.success).toBe(true);
      expect(result.emails).toHaveLength(1);
      expect(result.emails![0].from).toBe('sender@example.com');
      expect(result.emails![0].subject).toBe('Checking In');
      expect(result.emails![0].isUnread).toBe(true);
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEmails('bad-token', {
        maxResults: 10,
        unreadOnly: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEmails('test-token', {
        maxResults: 10,
        unreadOnly: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network failure');
    });

    it('passes query parameter when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await listEmails('test-token', {
        maxResults: 10,
        query: 'from:boss@company.com',
        unreadOnly: false,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('q=from%3Aboss%40company.com');
    });

    it('adds is:unread to query when unreadOnly is true', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await listEmails('test-token', {
        maxResults: 10,
        unreadOnly: true,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('is%3Aunread');
    });
  });

  describe('sendEmail', () => {
    it('sends email and returns message ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sent-msg-123' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendEmail('test-token', {
        to: 'recipient@example.com',
        subject: 'Hello',
        body: 'This is a test email.',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('sent-msg-123');
    });

    it('sends correct Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg1' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sendEmail('my-secret-token', {
        to: 'test@test.com',
        subject: 'Test',
        body: 'Body',
      });

      const options = mockFetch.mock.calls[0][1];
      expect(options.headers.Authorization).toBe('Bearer my-secret-token');
    });

    it('sends base64url-encoded raw message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg1' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sendEmail('token', {
        to: 'test@test.com',
        subject: 'Test Subject',
        body: 'Test body content',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.raw).toBeDefined();

      // Decode and verify the raw message contains expected headers
      const decoded = Buffer.from(body.raw, 'base64url').toString('utf-8');
      expect(decoded).toContain('To: test@test.com');
      expect(decoded).toContain('Subject: Test Subject');
      expect(decoded).toContain('Test body content');
      expect(decoded).toContain('Content-Type: text/plain');
      expect(decoded).toContain('MIME-Version: 1.0');
    });

    it('handles API errors on send', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendEmail('bad-token', {
        to: 'test@test.com',
        subject: 'Test',
        body: 'Body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });

    it('handles network errors on send', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendEmail('token', {
        to: 'test@test.com',
        subject: 'Test',
        body: 'Body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });
});