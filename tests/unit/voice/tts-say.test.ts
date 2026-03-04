/**
 * Unit tests for the OS-native TTS backend (tts-say).
 * Mocks child_process, node:os, node:fs, and nanoid to isolate
 * platform-specific behaviour for macOS, Linux, Windows, and unknown platforms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Module mocks — must be declared before the import under test       */
/* ------------------------------------------------------------------ */

vi.mock('node:os', () => ({
  default: {
    platform: vi.fn(() => 'darwin'),
    tmpdir: vi.fn(() => '/tmp'),
  },
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'abc12345'),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

/* ------------------------------------------------------------------ */
/* Imports — resolved after mocks are wired                           */
/* ------------------------------------------------------------------ */

import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createSayBackend } from '../../../src/voice/tts-say.js';
import type { TtsBackend, TtsSynthesizeOptions } from '../../../src/voice/types.js';

/* ------------------------------------------------------------------ */
/* Typed mock helpers                                                 */
/* ------------------------------------------------------------------ */

const mockPlatform = os.platform as ReturnType<typeof vi.fn>;
const mockTmpdir = os.tmpdir as ReturnType<typeof vi.fn>;
const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Create a fake WAV buffer of the given size for synthesis results. */
function fakeWavBuffer(sizeBytes: number = 3200): Buffer {
  return Buffer.alloc(sizeBytes, 0x42);
}

/** Expected temp file path produced with the mocked nanoid. */
const EXPECTED_TMP_FILE = '/tmp/lildude-tts-abc12345.wav';

/**
 * Build a backend with the given platform pre-set.
 * Because `os.platform()` is captured once inside `createSayBackend`,
 * we set the mock return value *before* calling the factory.
 */
function backendForPlatform(platform: string): TtsBackend {
  mockPlatform.mockReturnValue(platform);
  return createSayBackend();
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
  mockTmpdir.mockReturnValue('/tmp');
  mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */
/* Tests                                                              */
/* ================================================================== */

describe('createSayBackend', () => {
  it('returns an object with name "say"', () => {
    const backend = backendForPlatform('darwin');
    expect(backend.name).toBe('say');
  });

  /* ---------------------------------------------------------------- */
  /* isAvailable                                                      */
  /* ---------------------------------------------------------------- */

  describe('isAvailable', () => {
    it('returns true on macOS when `say` is found', async () => {
      const backend = backendForPlatform('darwin');
      mockExecSync.mockReturnValue('');

      const result = await backend.isAvailable();

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'which say',
        expect.objectContaining({ stdio: 'ignore', timeout: 3000 }),
      );
    });

    it('returns false on macOS when `say` is not found', async () => {
      const backend = backendForPlatform('darwin');
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await backend.isAvailable();

      expect(result).toBe(false);
    });

    it('returns true on Linux when espeak-ng is found', async () => {
      const backend = backendForPlatform('linux');
      mockExecSync.mockReturnValue('');

      const result = await backend.isAvailable();

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'which espeak-ng',
        expect.objectContaining({ stdio: 'ignore', timeout: 3000 }),
      );
    });

    it('returns true on Linux when espeak-ng fails but espeak is found', async () => {
      const backend = backendForPlatform('linux');
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        callCount++;
        if (cmd === 'which espeak-ng') {
          throw new Error('not found');
        }
        return '';
      });

      const result = await backend.isAvailable();

      expect(result).toBe(true);
      expect(callCount).toBe(2);
      expect(mockExecSync).toHaveBeenCalledWith(
        'which espeak',
        expect.objectContaining({ stdio: 'ignore', timeout: 3000 }),
      );
    });

    it('returns false on Linux when neither espeak-ng nor espeak is found', async () => {
      const backend = backendForPlatform('linux');
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await backend.isAvailable();

      expect(result).toBe(false);
    });

    it('returns true on Windows without executing any command', async () => {
      const backend = backendForPlatform('win32');

      const result = await backend.isAvailable();

      expect(result).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('returns false on unknown platforms', async () => {
      const backend = backendForPlatform('freebsd');

      const result = await backend.isAvailable();

      expect(result).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /* listVoices                                                       */
  /* ---------------------------------------------------------------- */

  describe('listVoices', () => {
    describe('macOS', () => {
      it('parses macOS voice list output', async () => {
        const backend = backendForPlatform('darwin');
        const mockOutput = [
          'Samantha           en_US    # Hello, my name is Samantha.',
          'Alex               en_US    # Most people recognize me by my voice.',
          'Kyoko              ja_JP    # ...',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(3);
        expect(voices[0]).toEqual({
          id: 'Samantha',
          name: 'Samantha',
          language: 'en-us',
        });
        expect(voices[1]).toEqual({
          id: 'Alex',
          name: 'Alex',
          language: 'en-us',
        });
        expect(voices[2]).toEqual({
          id: 'Kyoko',
          name: 'Kyoko',
          language: 'ja-jp',
        });
      });

      it('returns empty array when command fails', async () => {
        const backend = backendForPlatform('darwin');
        mockExecSync.mockImplementation(() => {
          throw new Error('say not found');
        });

        const voices = await backend.listVoices();

        expect(voices).toEqual([]);
      });

      it('skips malformed lines in voice list', async () => {
        const backend = backendForPlatform('darwin');
        const mockOutput = [
          'Samantha           en_US    # Hello',
          'badly formatted line without expected pattern',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(1);
        expect(voices[0].id).toBe('Samantha');
      });
    });

    describe('Linux', () => {
      it('parses espeak-ng voice list output', async () => {
        const backend = backendForPlatform('linux');
        // espeak-ng is found at /usr/bin/espeak-ng
        mockExistsSync.mockImplementation((filePath: string) => {
          return filePath === '/usr/bin/espeak-ng';
        });
        const mockOutput = [
          ' Pty Language       Age/Gender VoiceName          File          Other Languages',
          ' 5  en             M  english            other/en',
          ' 5  en-us          M  english-us         other/en-us',
          ' 5  fr             F  french             other/fr',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(3);
        expect(voices[0]).toEqual({
          id: 'english',
          name: 'english',
          language: 'en',
          gender: 'male',
        });
        expect(voices[2]).toEqual({
          id: 'french',
          name: 'french',
          language: 'fr',
          gender: 'female',
        });
      });

      it('falls back to espeak when espeak-ng is not installed', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockReturnValue(false);
        const mockOutput = [
          'Pty Language    Age/Gender VoiceName  File',
          ' 5  en          M  default        other/en',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(mockExecSync).toHaveBeenCalledWith(
          'espeak --voices',
          expect.objectContaining({ encoding: 'utf-8', timeout: 5000 }),
        );
        expect(voices).toHaveLength(1);
      });

      it('returns empty array when both espeak variants fail', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockReturnValue(false);
        mockExecSync.mockImplementation(() => {
          throw new Error('command not found');
        });

        const voices = await backend.listVoices();

        expect(voices).toEqual([]);
      });

      it('handles neutral gender for non M/F values', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockReturnValue(false);
        const mockOutput = [
          'Header line',
          ' 5  en          -  neutral_voice  other/en',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(1);
        expect(voices[0].gender).toBe('neutral');
      });
    });

    describe('Windows', () => {
      it('parses PowerShell voice list output', async () => {
        const backend = backendForPlatform('win32');
        const mockOutput = [
          'Microsoft David Desktop|en-US|Male',
          'Microsoft Zira Desktop|en-US|Female',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(2);
        expect(voices[0]).toEqual({
          id: 'Microsoft David Desktop',
          name: 'Microsoft David Desktop',
          language: 'en-US',
          gender: 'male',
        });
        expect(voices[1]).toEqual({
          id: 'Microsoft Zira Desktop',
          name: 'Microsoft Zira Desktop',
          language: 'en-US',
          gender: 'female',
        });
      });

      it('returns empty array when PowerShell fails', async () => {
        const backend = backendForPlatform('win32');
        mockExecSync.mockImplementation(() => {
          throw new Error('powershell error');
        });

        const voices = await backend.listVoices();

        expect(voices).toEqual([]);
      });

      it('skips lines with fewer than 3 pipe-separated parts', async () => {
        const backend = backendForPlatform('win32');
        const mockOutput = [
          'Microsoft David Desktop|en-US|Male',
          'incomplete|line',
          '',
        ].join('\n');
        mockExecSync.mockReturnValue(mockOutput);

        const voices = await backend.listVoices();

        expect(voices).toHaveLength(1);
      });
    });

    describe('unknown platform', () => {
      it('returns empty array', async () => {
        const backend = backendForPlatform('freebsd');

        const voices = await backend.listVoices();

        expect(voices).toEqual([]);
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /* synthesize                                                       */
  /* ---------------------------------------------------------------- */

  describe('synthesize', () => {
    const baseOptions: TtsSynthesizeOptions = { text: 'Hello world' };

    describe('macOS', () => {
      it('invokes `say` with correct arguments and returns audio', async () => {
        const backend = backendForPlatform('darwin');
        const wavData = fakeWavBuffer(6400);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(wavData);

        const result = await backend.synthesize(baseOptions);

        expect(mockExecFileSync).toHaveBeenCalledWith(
          'say',
          expect.arrayContaining(['-o', EXPECTED_TMP_FILE, '--data-format=LEI16@16000', 'Hello world']),
          expect.objectContaining({ timeout: 30000 }),
        );
        expect(result.audio).toBe(wavData);
        expect(result.format).toBe('wav');
        expect(result.backend).toBe('say');
        expect(result.durationSec).toBeCloseTo(6400 / 32000, 1);
      });

      it('passes voice option as -v argument', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', voice: 'Samantha' });

        expect(mockExecFileSync).toHaveBeenCalledWith(
          'say',
          expect.arrayContaining(['-v', 'Samantha']),
          expect.any(Object),
        );
      });

      it('passes rate option as -r with words-per-minute value', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', rate: 1.5 });

        // 175 * 1.5 = 262.5 => rounded to 263
        expect(mockExecFileSync).toHaveBeenCalledWith(
          'say',
          expect.arrayContaining(['-r', '263']),
          expect.any(Object),
        );
      });

      it('passes both voice and rate when provided', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', voice: 'Alex', rate: 2.0 });

        const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
        expect(callArgs).toContain('-v');
        expect(callArgs).toContain('Alex');
        expect(callArgs).toContain('-r');
        expect(callArgs).toContain('350');
      });
    });

    describe('Linux', () => {
      it('invokes espeak-ng when available', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockImplementation((filePath: string) => {
          if (filePath === '/usr/bin/espeak-ng') return true;
          if (filePath === EXPECTED_TMP_FILE) return true;
          return false;
        });
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        expect(mockExecFileSync).toHaveBeenCalledWith(
          'espeak-ng',
          expect.arrayContaining(['-w', EXPECTED_TMP_FILE, 'Hello world']),
          expect.objectContaining({ timeout: 30000 }),
        );
      });

      it('falls back to espeak when espeak-ng is not found', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockImplementation((filePath: string) => {
          if (filePath === '/usr/bin/espeak-ng') return false;
          if (filePath === EXPECTED_TMP_FILE) return true;
          return false;
        });
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        expect(mockExecFileSync).toHaveBeenCalledWith(
          'espeak',
          expect.arrayContaining(['-w', EXPECTED_TMP_FILE, 'Hello world']),
          expect.any(Object),
        );
      });

      it('passes voice option with -v flag', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockImplementation((filePath: string) => {
          if (filePath === '/usr/bin/espeak-ng') return false;
          if (filePath === EXPECTED_TMP_FILE) return true;
          return false;
        });
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', voice: 'en-us' });

        expect(mockExecFileSync).toHaveBeenCalledWith(
          'espeak',
          expect.arrayContaining(['-v', 'en-us']),
          expect.any(Object),
        );
      });

      it('passes rate option as -s with words-per-minute value', async () => {
        const backend = backendForPlatform('linux');
        mockExistsSync.mockImplementation((filePath: string) => {
          if (filePath === '/usr/bin/espeak-ng') return false;
          if (filePath === EXPECTED_TMP_FILE) return true;
          return false;
        });
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', rate: 0.5 });

        // 175 * 0.5 = 87.5 => rounded to 88
        expect(mockExecFileSync).toHaveBeenCalledWith(
          'espeak',
          expect.arrayContaining(['-s', '88']),
          expect.any(Object),
        );
      });
    });

    describe('Windows', () => {
      it('invokes PowerShell with SAPI script', async () => {
        const backend = backendForPlatform('win32');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('powershell'),
          expect.objectContaining({ timeout: 30000 }),
        );
        const psCommand = mockExecSync.mock.calls[0][0] as string;
        expect(psCommand).toContain('System.Speech.Synthesis');
        expect(psCommand).toContain('Hello world');
      });

      it('includes voice selection in PowerShell script when voice is set', async () => {
        const backend = backendForPlatform('win32');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi', voice: 'Microsoft David Desktop' });

        const psCommand = mockExecSync.mock.calls[0][0] as string;
        expect(psCommand).toContain('SelectVoice');
        expect(psCommand).toContain('Microsoft David Desktop');
      });

      it('sets rate value from options.rate', async () => {
        const backend = backendForPlatform('win32');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        // rate = 1.5 => (1.5 - 1) * 10 = 5
        await backend.synthesize({ text: 'Hi', rate: 1.5 });

        const psCommand = mockExecSync.mock.calls[0][0] as string;
        expect(psCommand).toContain('$synth.Rate = 5');
      });

      it('defaults rate to 0 when rate is not provided', async () => {
        const backend = backendForPlatform('win32');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: 'Hi' });

        const psCommand = mockExecSync.mock.calls[0][0] as string;
        expect(psCommand).toContain('$synth.Rate = 0');
      });

      it('escapes single quotes in text for PowerShell', async () => {
        const backend = backendForPlatform('win32');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize({ text: "it's a test" });

        const psCommand = mockExecSync.mock.calls[0][0] as string;
        expect(psCommand).toContain("it''s a test");
      });
    });

    describe('unsupported platform', () => {
      it('throws an error for unknown platform', async () => {
        const backend = backendForPlatform('freebsd');

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'TTS not supported on platform: freebsd',
        );
      });
    });

    /* -------------------------------------------------------------- */
    /* Result shape                                                   */
    /* -------------------------------------------------------------- */

    describe('result shape', () => {
      it('returns correct format and backend fields', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        const result = await backend.synthesize(baseOptions);

        expect(result.format).toBe('wav');
        expect(result.backend).toBe('say');
      });

      it('estimates duration based on audio buffer size', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        // 64000 bytes / 32000 bytes-per-sec = 2.0 seconds
        mockReadFileSync.mockReturnValue(fakeWavBuffer(64000));

        const result = await backend.synthesize(baseOptions);

        expect(result.durationSec).toBeCloseTo(2.0, 1);
      });

      it('clamps minimum duration to 0.1 seconds', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        // Very small buffer: 100 bytes / 32000 = 0.003125 => clamped to 0.1
        mockReadFileSync.mockReturnValue(fakeWavBuffer(100));

        const result = await backend.synthesize(baseOptions);

        expect(result.durationSec).toBe(0.1);
      });
    });

    /* -------------------------------------------------------------- */
    /* Error handling                                                  */
    /* -------------------------------------------------------------- */

    describe('error handling', () => {
      it('throws when output file does not exist after synthesis', async () => {
        const backend = backendForPlatform('darwin');
        // existsSync returns false for the output file
        mockExistsSync.mockReturnValue(false);

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'TTS synthesis produced no output file',
        );
      });

      it('throws when execFileSync fails (command error)', async () => {
        const backend = backendForPlatform('darwin');
        mockExecFileSync.mockImplementation(() => {
          throw new Error('say: command not found');
        });

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'say: command not found',
        );
      });

      it('throws when execSync fails on Windows', async () => {
        const backend = backendForPlatform('win32');
        mockExecSync.mockImplementation(() => {
          throw new Error('PowerShell execution failed');
        });

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'PowerShell execution failed',
        );
      });

      it('throws when readFileSync fails after synthesis', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockImplementation(() => {
          throw new Error('EACCES: permission denied');
        });

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'EACCES: permission denied',
        );
      });
    });

    /* -------------------------------------------------------------- */
    /* Temp file cleanup                                              */
    /* -------------------------------------------------------------- */

    describe('temp file cleanup', () => {
      it('deletes temp file after successful synthesis', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        // existsSync is called for the output check + cleanup check
        // unlinkSync should be called once for cleanup
        expect(mockUnlinkSync).toHaveBeenCalledWith(EXPECTED_TMP_FILE);
      });

      it('deletes temp file even when synthesis throws', async () => {
        const backend = backendForPlatform('darwin');
        // First call to existsSync (output check) returns false => throws
        // Second call in finally block should check and attempt cleanup
        let existsCallCount = 0;
        mockExistsSync.mockImplementation(() => {
          existsCallCount++;
          if (existsCallCount === 1) return false; // Output check fails
          return true; // Cleanup check succeeds
        });

        try {
          await backend.synthesize(baseOptions);
        } catch {
          // Expected to throw
        }

        expect(mockUnlinkSync).toHaveBeenCalledWith(EXPECTED_TMP_FILE);
      });

      it('does not throw when cleanup unlinkSync fails', async () => {
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());
        mockUnlinkSync.mockImplementation(() => {
          throw new Error('EBUSY: resource busy');
        });

        // Should not throw — cleanup errors are swallowed
        const result = await backend.synthesize(baseOptions);

        expect(result.audio).toBeInstanceOf(Buffer);
      });

      it('skips unlinkSync when temp file does not exist in finally', async () => {
        const backend = backendForPlatform('darwin');
        let existsCallCount = 0;
        mockExistsSync.mockImplementation(() => {
          existsCallCount++;
          if (existsCallCount === 1) return true; // Output file exists (synthesis check)
          return false; // Cleanup check: file already gone
        });
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        expect(mockUnlinkSync).not.toHaveBeenCalled();
      });
    });

    /* -------------------------------------------------------------- */
    /* Temp file path                                                 */
    /* -------------------------------------------------------------- */

    describe('temp file path generation', () => {
      it('uses os.tmpdir() for the temp directory', async () => {
        mockTmpdir.mockReturnValue('/custom/tmp');
        const backend = backendForPlatform('darwin');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(fakeWavBuffer());

        await backend.synthesize(baseOptions);

        const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
        const outputArg = callArgs[callArgs.indexOf('-o') + 1];
        expect(outputArg).toMatch(/^\/custom\/tmp\/lildude-tts-/);
      });
    });
  });
});
