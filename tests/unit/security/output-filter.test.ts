import { describe, it, expect } from 'vitest';
import { filterOutput } from '../../../src/security/output-filter.js';

describe('output-filter', () => {
  describe('filterOutput', () => {
    it('returns clean output unchanged', () => {
      const result = filterOutput('Hello! How can I help you today?');

      expect(result.hasLeaks).toBe(false);
      expect(result.leaks).toHaveLength(0);
      expect(result.filtered).toBe('Hello! How can I help you today?');
    });

    it('detects Anthropic API keys', () => {
      const result = filterOutput('Your key is sk-ant-api03-abc123def456ghi789jklmnopqrstuvwxyz');

      expect(result.hasLeaks).toBe(true);
      expect(result.leaks[0].type).toBe('anthropic_key');
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
      expect(result.filtered).not.toContain('sk-ant-api03');
    });

    it('detects OpenAI API keys', () => {
      const result = filterOutput('Use this key: sk-abcdefghijklmnopqrstuvwxyz12345');

      expect(result.hasLeaks).toBe(true);
      expect(result.leaks[0].type).toBe('openai_key');
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
    });

    it('detects Lil Dude API keys', () => {
      const result = filterOutput('Your API key is ld_abc123def456ghi789jklmnopqrst');

      expect(result.hasLeaks).toBe(true);
      const ldLeak = result.leaks.find((l) => l.type === 'lildude_api_key');
      expect(ldLeak).toBeDefined();
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
    });

    it('detects Bearer tokens', () => {
      const result = filterOutput('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');

      expect(result.hasLeaks).toBe(true);
      expect(result.filtered).toContain('Bearer [REDACTED]');
    });

    it('detects SQL CREATE TABLE statements', () => {
      const result = filterOutput('CREATE TABLE api_keys (id TEXT, key_hash TEXT)');

      expect(result.hasLeaks).toBe(true);
      const sqlLeak = result.leaks.find((l) => l.type === 'sql_schema');
      expect(sqlLeak).toBeDefined();
    });

    it('detects SQL queries on sensitive tables', () => {
      const result = filterOutput('Running: SELECT * FROM oauth_tokens');

      expect(result.hasLeaks).toBe(true);
      const sqlLeak = result.leaks.find((l) => l.type === 'sql_select_star');
      expect(sqlLeak).toBeDefined();
    });

    it('detects config path leaks', () => {
      const result = filterOutput('The config is at ~/.lil-dude/config.json');

      expect(result.hasLeaks).toBe(true);
      const pathLeak = result.leaks.find((l) => l.type === 'config_path');
      expect(pathLeak).toBeDefined();
    });

    it('detects private key blocks', () => {
      const result = filterOutput('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----');

      expect(result.hasLeaks).toBe(true);
      const keyLeak = result.leaks.find((l) => l.type === 'private_key');
      expect(keyLeak).toBeDefined();
      expect(result.filtered).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('detects environment variable dumps', () => {
      const result = filterOutput('LIL_DUDE_ANTHROPIC_KEY=sk-test-123');

      expect(result.hasLeaks).toBe(true);
      const envLeak = result.leaks.find((l) => l.type === 'env_var_dump');
      expect(envLeak).toBeDefined();
    });

    it('detects connection strings', () => {
      const result = filterOutput('Connected to postgres://user:pass@host:5432/db');

      expect(result.hasLeaks).toBe(true);
      const connLeak = result.leaks.find((l) => l.type === 'connection_string');
      expect(connLeak).toBeDefined();
    });

    it('handles multiple leaks in one output', () => {
      const result = filterOutput(
        'Key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz and path ~/.lil-dude/secrets.json',
      );

      expect(result.hasLeaks).toBe(true);
      expect(result.leaks.length).toBeGreaterThanOrEqual(2);
    });

    it('truncates long matches in leak details', () => {
      const result = filterOutput('-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(100) + '\n-----END PRIVATE KEY-----');

      expect(result.hasLeaks).toBe(true);
      const keyLeak = result.leaks.find((l) => l.type === 'private_key');
      expect(keyLeak).toBeDefined();
      expect(keyLeak!.match.length).toBeLessThanOrEqual(40);
    });
  });
});
