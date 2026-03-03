/**
 * Wave manifest verification via HMAC-SHA256 signatures.
 * Signed waves get a "verified" badge. Unsigned waves still install with a warning.
 * The signing key is shared between the registry CI pipeline and Lil Dude clients.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createModuleLogger } from '../utils/logger.js';

const verifierLogger = createModuleLogger('manifest-verifier');

/** Result of a manifest signature verification. */
export interface VerificationResult {
  verified: boolean;
  reason: string;
  signedAt?: string;
  signer?: string;
}

/** Contents of a .wave-signature file. */
interface WaveSignature {
  signature: string;
  algorithm: string;
  signer: string;
  signedAt: string;
}

/** Signature filename placed alongside wave.json. */
const SIGNATURE_FILE = '.wave-signature';

/** HMAC algorithm used for signing. */
const HMAC_ALGORITHM = 'sha256';

/**
 * Generate an HMAC-SHA256 signature for a wave manifest.
 * Used by the registry CI pipeline to sign verified waves.
 *
 * @param manifestJson - The raw JSON string of the wave.json manifest.
 * @param signingKey - The shared secret key.
 * @returns The hex-encoded HMAC signature.
 */
export function signManifest(manifestJson: string, signingKey: string): string {
  if (!signingKey || signingKey.length < 16) {
    throw new Error('Signing key must be at least 16 characters');
  }

  const hmac = createHmac(HMAC_ALGORITHM, signingKey);
  hmac.update(manifestJson);
  return hmac.digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature for a wave manifest.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param manifestJson - The raw JSON string of the wave.json manifest.
 * @param signature - The hex-encoded HMAC signature to verify.
 * @param signingKey - The shared secret key.
 * @returns True if the signature is valid.
 */
export function verifySignature(
  manifestJson: string,
  signature: string,
  signingKey: string,
): boolean {
  try {
    const expectedSignature = signManifest(manifestJson, signingKey);
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    verifierLogger.warn({ error: errorMessage }, 'Signature verification error');
    return false;
  }
}

/**
 * Verify a wave directory's manifest signature.
 * Reads wave.json and .wave-signature from the wave directory.
 *
 * @param waveDir - Path to the wave directory.
 * @param signingKey - The shared secret key. If not provided, returns unverified.
 * @returns Verification result with details.
 */
export function verifyWaveDirectory(
  waveDir: string,
  signingKey?: string,
): VerificationResult {
  const manifestPath = join(waveDir, 'wave.json');
  const signaturePath = join(waveDir, SIGNATURE_FILE);

  // No manifest = can't verify
  if (!existsSync(manifestPath)) {
    return { verified: false, reason: 'No wave.json found' };
  }

  // No signature file = unsigned wave
  if (!existsSync(signaturePath)) {
    verifierLogger.debug({ waveDir }, 'No signature file found — wave is unsigned');
    return { verified: false, reason: 'Wave is unsigned (no .wave-signature file)' };
  }

  // No signing key configured = can't verify
  if (!signingKey) {
    return { verified: false, reason: 'No signing key configured' };
  }

  try {
    const manifestJson = readFileSync(manifestPath, 'utf-8');
    const signatureJson = readFileSync(signaturePath, 'utf-8');
    const signatureData = JSON.parse(signatureJson) as WaveSignature;

    if (!signatureData.signature || !signatureData.algorithm) {
      return { verified: false, reason: 'Invalid signature file format' };
    }

    if (signatureData.algorithm !== HMAC_ALGORITHM) {
      return {
        verified: false,
        reason: `Unsupported algorithm: ${signatureData.algorithm}`,
      };
    }

    const isValid = verifySignature(manifestJson, signatureData.signature, signingKey);

    if (isValid) {
      verifierLogger.info(
        { waveDir, signer: signatureData.signer },
        'Wave signature verified',
      );
      return {
        verified: true,
        reason: 'Signature valid',
        signedAt: signatureData.signedAt,
        signer: signatureData.signer,
      };
    }

    verifierLogger.warn({ waveDir }, 'Wave signature verification FAILED');
    return { verified: false, reason: 'Signature does not match manifest' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    verifierLogger.warn({ waveDir, error: errorMessage }, 'Error verifying wave signature');
    return { verified: false, reason: `Verification error: ${errorMessage}` };
  }
}

/**
 * Create a .wave-signature file content for a manifest.
 * Used by the CI pipeline to sign wave manifests.
 *
 * @param manifestJson - The raw JSON string of the wave.json manifest.
 * @param signingKey - The shared secret key.
 * @param signer - Identity of the signer (e.g., "lildude-ci").
 * @returns The signature file contents as a JSON string.
 */
export function createSignatureFile(
  manifestJson: string,
  signingKey: string,
  signer: string,
): string {
  const signature = signManifest(manifestJson, signingKey);
  const signatureData: WaveSignature = {
    signature,
    algorithm: HMAC_ALGORITHM,
    signer,
    signedAt: new Date().toISOString(),
  };
  return JSON.stringify(signatureData, null, 2);
}
