/**
 * TTS backend using OS-native text-to-speech.
 * Uses the system's built-in speech synthesis:
 * - macOS: `say` command (high quality, many voices)
 * - Linux: `espeak-ng` or `espeak` (lighter weight)
 * - Windows: PowerShell `System.Speech.Synthesis`
 *
 * Zero dependencies. Uses child_process to invoke the OS command.
 * Output is WAV format written to a temp file, then read into a Buffer.
 *
 * This is the lightest-weight TTS option (~0 KB overhead).
 */

import os from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import type {
  TtsBackend,
  TtsBackendName,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from './types.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('tts-say');

/**
 * Create a TTS backend using OS-native speech synthesis.
 * No external dependencies required — uses macOS `say`, Linux `espeak`, or Windows SAPI.
 *
 * @returns A TtsBackend implementation using OS native TTS.
 */
export function createSayBackend(): TtsBackend {
  const platform = os.platform();

  return {
    name: 'say' as TtsBackendName,

    async isAvailable(): Promise<boolean> {
      try {
        if (platform === 'darwin') {
          execSync('which say', { stdio: 'ignore', timeout: 3000 });
          return true;
        }
        if (platform === 'linux') {
          try {
            execSync('which espeak-ng', { stdio: 'ignore', timeout: 3000 });
            return true;
          } catch {
            execSync('which espeak', { stdio: 'ignore', timeout: 3000 });
            return true;
          }
        }
        if (platform === 'win32') {
          // PowerShell speech synthesis is always available on Windows 10+
          return true;
        }
        return false;
      } catch {
        log.debug({ platform }, 'OS native TTS not available');
        return false;
      }
    },

    async listVoices(): Promise<TtsVoiceInfo[]> {
      try {
        if (platform === 'darwin') {
          return listMacVoices();
        }
        if (platform === 'linux') {
          return listLinuxVoices();
        }
        if (platform === 'win32') {
          return listWindowsVoices();
        }
        return [];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn({ error: message }, 'Failed to list OS voices');
        return [];
      }
    },

    async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `lildude-tts-${nanoid(8)}.wav`);

      try {
        const startTime = Date.now();

        if (platform === 'darwin') {
          synthesizeMac(options, tmpFile);
        } else if (platform === 'linux') {
          synthesizeLinux(options, tmpFile);
        } else if (platform === 'win32') {
          synthesizeWindows(options, tmpFile);
        } else {
          throw new Error(`TTS not supported on platform: ${platform}`);
        }

        if (!existsSync(tmpFile)) {
          throw new Error('TTS synthesis produced no output file');
        }

        const audio = readFileSync(tmpFile);
        const elapsedMs = Date.now() - startTime;

        // Rough estimate: WAV at 16kHz mono is ~32KB/sec
        const durationSec = Math.max(0.1, audio.length / 32000);

        log.info(
          { textLength: options.text.length, audioBytes: audio.length, elapsedMs },
          'OS native TTS synthesis complete',
        );

        return {
          audio,
          format: 'wav',
          durationSec,
          backend: 'say',
        };
      } finally {
        // Clean up temp file
        try {
          if (existsSync(tmpFile)) {
            unlinkSync(tmpFile);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}

/**
 * List available voices on macOS using `say -v '?'`.
 */
function listMacVoices(): TtsVoiceInfo[] {
  const output = execSync("say -v '?'", { encoding: 'utf-8', timeout: 5000 });
  const voices: TtsVoiceInfo[] = [];

  for (const line of output.split('\n')) {
    // Format: "Samantha           en_US    # ..."
    const match = line.match(/^(\S+)\s+(\w{2}_\w{2})\s+#/);
    if (match) {
      voices.push({
        id: match[1],
        name: match[1],
        language: match[2].replace('_', '-').toLowerCase(),
      });
    }
  }

  return voices;
}

/**
 * List available voices on Linux using espeak.
 */
function listLinuxVoices(): TtsVoiceInfo[] {
  try {
    const cmd = existsSync('/usr/bin/espeak-ng') ? 'espeak-ng' : 'espeak';
    const output = execSync(`${cmd} --voices`, { encoding: 'utf-8', timeout: 5000 });
    const voices: TtsVoiceInfo[] = [];

    for (const line of output.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        voices.push({
          id: parts[3],
          name: parts[3],
          language: parts[1],
          gender: parts[2] === 'M' ? 'male' : parts[2] === 'F' ? 'female' : 'neutral',
        });
      }
    }

    return voices;
  } catch {
    return [];
  }
}

/**
 * List available voices on Windows via PowerShell.
 */
function listWindowsVoices(): TtsVoiceInfo[] {
  try {
    const script = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name + '|' + $_.VoiceInfo.Gender }
    `;
    const output = execSync(`powershell -Command "${script}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const voices: TtsVoiceInfo[] = [];

    for (const line of output.split('\n')) {
      const parts = line.trim().split('|');
      if (parts.length >= 3) {
        voices.push({
          id: parts[0],
          name: parts[0],
          language: parts[1],
          gender: parts[2].toLowerCase() === 'male' ? 'male' : 'female',
        });
      }
    }

    return voices;
  } catch {
    return [];
  }
}

/**
 * Synthesize speech on macOS using the `say` command.
 */
function synthesizeMac(options: TtsSynthesizeOptions, outputPath: string): void {
  const args: string[] = ['-o', outputPath, '--data-format=LEI16@16000'];

  if (options.voice) {
    args.push('-v', options.voice);
  }
  if (options.rate) {
    // macOS say uses words per minute (default ~175)
    const wpm = Math.round(175 * options.rate);
    args.push('-r', String(wpm));
  }

  args.push(options.text);
  execFileSync('say', args, { timeout: 30000 });
}

/**
 * Synthesize speech on Linux using espeak.
 */
function synthesizeLinux(options: TtsSynthesizeOptions, outputPath: string): void {
  const cmd = existsSync('/usr/bin/espeak-ng') ? 'espeak-ng' : 'espeak';
  const args: string[] = ['-w', outputPath];

  if (options.voice) {
    args.push('-v', options.voice);
  }
  if (options.rate) {
    // espeak uses words per minute (default 175)
    const wpm = Math.round(175 * options.rate);
    args.push('-s', String(wpm));
  }

  args.push(options.text);
  execFileSync(cmd, args, { timeout: 30000 });
}

/**
 * Synthesize speech on Windows using PowerShell.
 */
function synthesizeWindows(options: TtsSynthesizeOptions, outputPath: string): void {
  const escapedText = options.text.replace(/'/g, "''").replace(/"/g, '`"');
  const voiceSelect = options.voice
    ? `$synth.SelectVoice('${options.voice.replace(/'/g, "''")}');`
    : '';
  const rateVal = options.rate ? Math.round((options.rate - 1) * 10) : 0;

  const script = `
    Add-Type -AssemblyName System.Speech;
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    ${voiceSelect}
    $synth.Rate = ${rateVal};
    $synth.SetOutputToWaveFile('${outputPath.replace(/'/g, "''")}');
    $synth.Speak('${escapedText}');
    $synth.Dispose();
  `;

  execSync(`powershell -Command "${script}"`, { timeout: 30000 });
}
