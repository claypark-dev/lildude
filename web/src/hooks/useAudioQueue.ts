/**
 * Sequential audio playback queue.
 * Plays audio blobs one at a time to prevent overlapping speech.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioQueueItem {
  blob: Blob;
  id: string;
}

export interface AudioQueueState {
  /** Whether audio is currently playing. */
  playing: boolean;
  /** The message ID of the currently playing audio. */
  currentId: string | null;
  /** Enqueue an audio blob for playback. */
  enqueue: (blob: Blob, id: string) => void;
  /** Stop current playback and clear the queue. */
  stop: () => void;
}

/**
 * Hook providing a sequential audio playback queue.
 * Audio items are played one at a time in order.
 */
export function useAudioQueue(): AudioQueueState {
  const [playing, setPlaying] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const queueRef = useRef<AudioQueueItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const processingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const processNext = useCallback(() => {
    if (processingRef.current) return;

    const next = queueRef.current.shift();
    if (!next) {
      setPlaying(false);
      setCurrentId(null);
      return;
    }

    processingRef.current = true;
    cleanup();

    const url = URL.createObjectURL(next.blob);
    blobUrlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);
    setCurrentId(next.id);

    audio.onended = () => {
      processingRef.current = false;
      cleanup();
      processNext();
    };

    audio.onerror = () => {
      processingRef.current = false;
      cleanup();
      processNext();
    };

    audio.play().catch(() => {
      processingRef.current = false;
      cleanup();
      processNext();
    });
  }, [cleanup]);

  const enqueue = useCallback((blob: Blob, id: string) => {
    queueRef.current.push({ blob, id });
    if (!processingRef.current) {
      processNext();
    }
  }, [processNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    processingRef.current = false;
    cleanup();
    setPlaying(false);
    setCurrentId(null);
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      queueRef.current = [];
      processingRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  return { playing, currentId, enqueue, stop };
}
