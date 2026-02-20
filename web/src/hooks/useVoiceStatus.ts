import { useState, useEffect } from 'react';
import { fetchVoiceStatus } from '../lib/api.ts';

/**
 * Hook to check whether voice synthesis is enabled.
 * Fetches status from the backend on mount.
 */
export function useVoiceStatus() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVoiceStatus()
      .then((status) => {
        setEnabled(status.enabled);
      })
      .catch(() => {
        setEnabled(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { enabled, loading };
}
