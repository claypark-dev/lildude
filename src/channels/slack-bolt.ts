/**
 * Slack Bolt client factory.
 * Creates a SlackClient backed by @slack/bolt for production use.
 * Users must install @slack/bolt separately.
 * See HLD Section 10 for channel adapter architecture.
 */

import type { SlackClient, SlackMessageEvent, SlackPostMessageOptions } from './slack.js';

/**
 * Create a SlackClient using the @slack/bolt library via dynamic import.
 * This factory is used in production. Users must install @slack/bolt.
 *
 * @param config - Token and appToken for Socket Mode.
 * @returns A SlackClient backed by @slack/bolt.
 */
export async function createBoltClient(config: {
  token: string;
  appToken: string;
}): Promise<SlackClient> {
  const bolt = await import('@slack/bolt');
  const app = new bolt.App({
    token: config.token,
    appToken: config.appToken,
    socketMode: true,
  });

  let messageCallback: ((event: SlackMessageEvent) => Promise<void>) | undefined;

  app.message(async ({ message }) => {
    if (messageCallback && message && 'text' in message) {
      const msg = message as Record<string, unknown>;
      const slackEvent: SlackMessageEvent = {
        type: 'message',
        channel: String(msg.channel ?? ''),
        user: String(msg.user ?? ''),
        text: String(msg.text ?? ''),
        ts: String(msg.ts ?? ''),
        thread_ts: msg.thread_ts ? String(msg.thread_ts) : undefined,
      };
      await messageCallback(slackEvent);
    }
  });

  return {
    async start(): Promise<void> {
      await app.start();
    },
    async stop(): Promise<void> {
      await app.stop();
    },
    onMessage(handler: (event: SlackMessageEvent) => Promise<void>): void {
      messageCallback = handler;
    },
    async postMessage(options: SlackPostMessageOptions): Promise<void> {
      await app.client.chat.postMessage(options);
    },
  };
}
