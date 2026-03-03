/**
 * Tests for the Google Calendar API wrapper module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listEvents,
  createEvent,
  deleteEvent,
} from '../../../src/integrations/google-calendar.js';

describe('Google Calendar Integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listEvents()', () => {
    it('returns events from the API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'evt1',
                summary: 'Team Standup',
                start: { dateTime: '2026-03-03T10:00:00Z' },
                end: { dateTime: '2026-03-03T10:30:00Z' },
                location: 'Conference Room A',
              },
              {
                id: 'evt2',
                summary: 'Lunch',
                start: { dateTime: '2026-03-03T12:00:00Z' },
                end: { dateTime: '2026-03-03T13:00:00Z' },
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('test-token');

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(2);
      expect(result.events![0].id).toBe('evt1');
      expect(result.events![0].summary).toBe('Team Standup');
      expect(result.events![0].start).toBe('2026-03-03T10:00:00Z');
      expect(result.events![0].location).toBe('Conference Room A');
      expect(result.events![1].id).toBe('evt2');
      expect(result.events![1].location).toBeUndefined();
    });

    it('returns empty array when no items', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('test-token');

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(0);
    });

    it('returns empty array when items field is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('test-token');

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(0);
    });

    it('handles date-only events (all-day)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'allday1',
                summary: 'Holiday',
                start: { date: '2026-03-03' },
                end: { date: '2026-03-04' },
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('test-token');

      expect(result.success).toBe(true);
      expect(result.events![0].start).toBe('2026-03-03');
      expect(result.events![0].end).toBe('2026-03-04');
    });

    it('handles events with missing summary', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'no-title',
                start: { dateTime: '2026-03-03T10:00:00Z' },
                end: { dateTime: '2026-03-03T11:00:00Z' },
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('test-token');

      expect(result.success).toBe(true);
      expect(result.events![0].summary).toBe('(no title)');
    });

    it('passes Authorization header with token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await listEvents('my-secret-token');

      const options = mockFetch.mock.calls[0][1];
      expect(options.headers.Authorization).toBe('Bearer my-secret-token');
    });

    it('passes timeMin and timeMax query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await listEvents('token', '2026-03-01T00:00:00Z', '2026-03-08T00:00:00Z');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('timeMin=2026-03-01T00%3A00%3A00Z');
      expect(calledUrl).toContain('timeMax=2026-03-08T00%3A00%3A00Z');
      expect(calledUrl).toContain('singleEvents=true');
      expect(calledUrl).toContain('orderBy=startTime');
    });

    it('passes custom maxResults', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await listEvents('token', undefined, undefined, 10);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('maxResults=10');
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('bad-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
      expect(result.error).toContain('Unauthorized');
    });

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network failure');
    });

    it('includes optional fields when present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'evt1',
                summary: 'Meeting',
                start: { dateTime: '2026-03-03T10:00:00Z' },
                end: { dateTime: '2026-03-03T11:00:00Z' },
                location: 'Room 101',
                description: 'Weekly sync',
                htmlLink: 'https://calendar.google.com/event/evt1',
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await listEvents('token');

      expect(result.events![0].location).toBe('Room 101');
      expect(result.events![0].description).toBe('Weekly sync');
      expect(result.events![0].htmlLink).toBe('https://calendar.google.com/event/evt1');
    });
  });

  describe('createEvent()', () => {
    it('creates an event and returns it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'new-event-123',
            summary: 'Team Meeting',
            htmlLink: 'https://calendar.google.com/event/new-event-123',
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createEvent(
        'test-token',
        'Team Meeting',
        '2026-03-05T14:00:00Z',
        '2026-03-05T15:00:00Z',
      );

      expect(result.success).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event!.id).toBe('new-event-123');
      expect(result.event!.summary).toBe('Team Meeting');
      expect(result.event!.start).toBe('2026-03-05T14:00:00Z');
      expect(result.event!.end).toBe('2026-03-05T15:00:00Z');
      expect(result.event!.htmlLink).toBe('https://calendar.google.com/event/new-event-123');
    });

    it('sends POST request to correct URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'evt1', summary: 'Test' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await createEvent('token', 'Test', '2026-03-05T14:00:00Z', '2026-03-05T15:00:00Z');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      const options = mockFetch.mock.calls[0][1] as RequestInit;

      expect(calledUrl).toContain('calendars/primary/events');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
      );
    });

    it('sends event body with timezone', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'evt1', summary: 'Test' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await createEvent(
        'token',
        'My Event',
        '2026-03-05T14:00:00Z',
        '2026-03-05T15:00:00Z',
        'Discuss project',
        'Office',
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.summary).toBe('My Event');
      expect(body.description).toBe('Discuss project');
      expect(body.location).toBe('Office');
      expect(body.start.dateTime).toBe('2026-03-05T14:00:00Z');
      expect(body.end.dateTime).toBe('2026-03-05T15:00:00Z');
      expect(body.start.timeZone).toBeDefined();
      expect(body.end.timeZone).toBeDefined();
    });

    it('omits optional fields when not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'evt1', summary: 'Simple' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await createEvent('token', 'Simple', '2026-03-05T14:00:00Z', '2026-03-05T15:00:00Z');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.description).toBeUndefined();
      expect(body.location).toBeUndefined();
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createEvent(
        'bad-token',
        'Test',
        '2026-03-05T14:00:00Z',
        '2026-03-05T15:00:00Z',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await createEvent(
        'token',
        'Test',
        '2026-03-05T14:00:00Z',
        '2026-03-05T15:00:00Z',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('deleteEvent()', () => {
    it('deletes an event successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await deleteEvent('test-token', 'event-to-delete');

      expect(result.success).toBe(true);
    });

    it('sends DELETE request to correct URL with encoded event ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await deleteEvent('token', 'event/special+chars');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      const options = mockFetch.mock.calls[0][1] as RequestInit;

      expect(calledUrl).toContain('calendars/primary/events/');
      expect(calledUrl).toContain(encodeURIComponent('event/special+chars'));
      expect(options.method).toBe('DELETE');
      expect(options.headers).toEqual(
        expect.objectContaining({ Authorization: 'Bearer token' }),
      );
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await deleteEvent('token', 'nonexistent-event');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Timeout'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await deleteEvent('token', 'evt1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });
});
