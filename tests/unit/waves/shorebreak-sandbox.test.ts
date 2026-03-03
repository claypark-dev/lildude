/**
 * Tests for the Shorebreak sandbox module.
 */

import { describe, it, expect } from 'vitest';
import { executeSandboxed } from '../../../src/waves/shorebreak-sandbox.js';

describe('ShorebreakSandbox', () => {
  describe('executeSandboxed', () => {
    it('executes simple code that returns a string', async () => {
      const code = `var execute = async function(params) { return "Hello, " + (params.name || "world"); };`;
      const result = await executeSandboxed(code, { name: 'Lil Dude' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello, Lil Dude');
    });

    it('executes code that returns an object (serialized as JSON)', async () => {
      const code = `var execute = async function(params) { return { greeting: "hi", count: 42 }; };`;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(JSON.parse(result.output)).toEqual({ greeting: 'hi', count: 42 });
    });

    it('captures console.log output', async () => {
      const code = `
        var execute = async function(params) {
          console.log("debug info");
          console.log("more info", 123);
          return "done";
        };
      `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(result.logs).toContain('debug info');
      expect(result.logs.some((l) => l.includes('more info'))).toBe(true);
    });

    it('captures console.warn and console.error with prefixes', async () => {
      const code = `
        var execute = async function(params) {
          console.warn("warning msg");
          console.error("error msg");
          return "done";
        };
      `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(result.logs.some((l) => l.includes('[WARN]'))).toBe(true);
      expect(result.logs.some((l) => l.includes('[ERROR]'))).toBe(true);
    });

    it('fails when execute function is not defined', async () => {
      const code = `var notExecute = function() { return "nope"; };`;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('execute function');
    });

    it('blocks access to process', async () => {
      const code = `var execute = async function(params) { return String(process); };`;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      // process is undefined in the sandbox, so String(undefined) = "undefined"
      expect(result.output).toBe('undefined');
    });

    it('blocks access to require', async () => {
      const code = `var execute = async function(params) { return String(require); };`;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('undefined');
    });

    it('provides JSON utilities', async () => {
      const code = `
        var execute = async function(params) {
          var obj = JSON.parse('{"key":"value"}');
          return JSON.stringify(obj);
        };
      `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(JSON.parse(result.output)).toEqual({ key: 'value' });
    });

    it('provides Date access', async () => {
      const code = `
        var execute = async function(params) {
          var d = new Date();
          return typeof d.getTime();
        };
      `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('number');
    });

    it('provides Math utilities', async () => {
      const code = `var execute = async function(params) { return String(Math.floor(3.7)); };`;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('3');
    });

    it('handles runtime errors gracefully', async () => {
      const code = `
        var execute = async function(params) {
          throw new Error("Something went wrong");
        };
      `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Something went wrong');
    });

    it('handles syntax errors gracefully', async () => {
      const code = `var execute = async function(params) { return `;
      const result = await executeSandboxed(code, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('times out on long-running code', async () => {
      const code = `
        var execute = async function(params) {
          var i = 0;
          while (true) { i++; }
          return String(i);
        };
      `;
      const result = await executeSandboxed(code, {}, [], 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 10_000);

    it('passes parameters to the execute function', async () => {
      const code = `
        var execute = async function(params) {
          return "Got: " + params.query + " in " + params.city;
        };
      `;
      const result = await executeSandboxed(code, { query: 'weather', city: 'NYC' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Got: weather in NYC');
    });
  });
});
