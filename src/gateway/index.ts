/**
 * Gateway module public API.
 * Re-exports the server factory and WebSocket manager.
 */

export { createGatewayServer } from './server.js';
export type { GatewayServer } from './server.js';
export { createWSManager } from './ws.js';
export type { WSManager, WSClient, WSOutgoingMessage, WSMessageHandler } from './ws.js';
