/**
 * Completion screen with auto-restart countdown.
 * Shows a 10-second countdown, a "Restart Now" button, and polls
 * for the server to come back online after restarting.
 */

import { useState, useEffect, useRef } from 'react';
import { triggerRestart, fetchHealth } from '../../lib/api.ts';

const COUNTDOWN_SECONDS = 10;
const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 30_000;

/** Setup completion screen with auto-restart countdown and polling */
export function CompletionScreen() {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [restarting, setRestarting] = useState(false);
  const [waitingForServer, setWaitingForServer] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const restartCalledRef = useRef(false);

  // Countdown timer
  useEffect(() => {
    if (restarting) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [restarting]);

  // Trigger restart when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && !restartCalledRef.current) {
      handleRestart();
    }
  }, [countdown]);

  // Poll for server health after restart
  useEffect(() => {
    if (!waitingForServer) return;

    const startTime = Date.now();
    const interval = setInterval(async () => {
      try {
        await fetchHealth();
        clearInterval(interval);
        window.location.href = '/';
      } catch {
        if (Date.now() - startTime > HEALTH_TIMEOUT_MS) {
          clearInterval(interval);
          setRestartError(
            'Server is taking longer than expected. You may need to restart manually.',
          );
          setWaitingForServer(false);
        }
      }
    }, HEALTH_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [waitingForServer]);

  /** Initiate the server restart */
  async function handleRestart() {
    if (restartCalledRef.current) return;
    restartCalledRef.current = true;
    setRestarting(true);
    setRestartError(null);

    try {
      await triggerRestart();
    } catch {
      // Expected — the server may close before sending the full response
    }

    // Wait briefly for the old server to shut down, then start polling
    setTimeout(() => {
      setWaitingForServer(true);
    }, 1500);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">
          {waitingForServer ? '\u23F3' : '\uD83C\uDF89'}
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">
          {waitingForServer ? 'Restarting...' : 'Setup Complete!'}
        </h1>

        {/* Waiting for server to come back */}
        {waitingForServer && (
          <div className="space-y-4">
            <p className="text-[#a0a0a0]">
              Waiting for Lil Dude to come back online...
            </p>
            <div className="flex justify-center">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        )}

        {/* Countdown state */}
        {!restarting && !restartError && (
          <div className="space-y-4">
            <p className="text-[#a0a0a0]">
              Restarting in{' '}
              <span className="text-white font-mono font-bold text-lg">
                {countdown}
              </span>{' '}
              seconds...
            </p>
            <button
              type="button"
              onClick={handleRestart}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-slate-900
                         font-semibold rounded-xl transition-colors"
            >
              Restart Now
            </button>
          </div>
        )}

        {/* Restarting (before polling) */}
        {restarting && !waitingForServer && !restartError && (
          <div className="space-y-4">
            <p className="text-[#a0a0a0]">Shutting down...</p>
            <div className="flex justify-center">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        )}

        {/* Error / fallback */}
        {restartError && (
          <div className="space-y-4">
            <p className="text-amber-400 text-sm">{restartError}</p>
            <p className="text-[#a0a0a0] text-sm">
              Run this command to start manually:
            </p>
            <code className="block bg-[#111] text-green-400 px-4 py-3 rounded-lg text-sm font-mono">
              lil-dude start
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
