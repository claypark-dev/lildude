import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  loadMcpServerConfigs,
  saveMcpServerConfig,
  deleteMcpServerConfig,
} from '../../../src/integrations/mcp-client.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('mcp-client persistence', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('saveMcpServerConfig stores a stdio server', () => {
    saveMcpServerConfig(db, {
      name: 'test-server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    });

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test-server');
    expect(configs[0].transport).toBe('stdio');
    expect(configs[0].command).toBe('npx');
    expect(configs[0].args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
  });

  it('saveMcpServerConfig stores an SSE server', () => {
    saveMcpServerConfig(db, {
      name: 'remote-server',
      transport: 'sse',
      url: 'https://mcp.example.com/sse',
    });

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('remote-server');
    expect(configs[0].transport).toBe('sse');
    expect(configs[0].url).toBe('https://mcp.example.com/sse');
  });

  it('saveMcpServerConfig upserts on same name', () => {
    saveMcpServerConfig(db, {
      name: 'server',
      transport: 'stdio',
      command: 'old-cmd',
    });

    saveMcpServerConfig(db, {
      name: 'server',
      transport: 'stdio',
      command: 'new-cmd',
    });

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(1);
    expect(configs[0].command).toBe('new-cmd');
  });

  it('loadMcpServerConfigs returns empty array for no servers', () => {
    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(0);
  });

  it('loadMcpServerConfigs skips disabled servers', () => {
    saveMcpServerConfig(db, {
      name: 'enabled-server',
      transport: 'stdio',
      command: 'cmd1',
    });

    db.prepare(`
      INSERT INTO mcp_servers (name, transport, command, enabled)
      VALUES ('disabled-server', 'stdio', 'cmd2', 0)
    `).run();

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('enabled-server');
  });

  it('deleteMcpServerConfig removes a server', () => {
    saveMcpServerConfig(db, {
      name: 'to-delete',
      transport: 'stdio',
      command: 'cmd',
    });

    const deleted = deleteMcpServerConfig(db, 'to-delete');
    expect(deleted).toBe(true);

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(0);
  });

  it('deleteMcpServerConfig returns false for nonexistent', () => {
    const deleted = deleteMcpServerConfig(db, 'nonexistent');
    expect(deleted).toBe(false);
  });

  it('saveMcpServerConfig stores env as JSON', () => {
    saveMcpServerConfig(db, {
      name: 'env-server',
      transport: 'stdio',
      command: 'cmd',
      env: { MY_TOKEN: 'secret123', DEBUG: '1' },
    });

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(1);
    expect(configs[0].env).toEqual({ MY_TOKEN: 'secret123', DEBUG: '1' });
  });

  it('handles multiple servers', () => {
    saveMcpServerConfig(db, { name: 'server-a', transport: 'stdio', command: 'a' });
    saveMcpServerConfig(db, { name: 'server-b', transport: 'sse', url: 'http://b' });
    saveMcpServerConfig(db, { name: 'server-c', transport: 'stdio', command: 'c' });

    const configs = loadMcpServerConfigs(db);
    expect(configs).toHaveLength(3);
  });
});
