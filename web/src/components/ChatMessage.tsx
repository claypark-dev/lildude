import { useState, useRef, useEffect } from 'react';
import type { ChatMessage as ChatMessageType } from '../lib/types.ts';
import { synthesizeSpeech } from '../lib/api.ts';

interface ChatMessageProps {
  message: ChatMessageType;
  voiceEnabled?: boolean;
}

/** TTS playback state */
type PlayState = 'idle' | 'loading' | 'playing';

/** Single chat message bubble with optional TTS play button for assistant messages */
export function ChatMessage({ message, voiceEnabled = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [playState, setPlayState] = useState<PlayState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Revoke blob URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  async function handlePlay() {
    if (playState === 'playing') {
      // Pause
      audioRef.current?.pause();
      setPlayState('idle');
      return;
    }

    setPlayState('loading');

    try {
      const blob = await synthesizeSpeech(message.text);
      const url = URL.createObjectURL(blob);

      // Clean up previous blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => setPlayState('idle');
      audio.onerror = () => setPlayState('idle');

      await audio.play();
      setPlayState('playing');
    } catch {
      setPlayState('idle');
    }
  }

  const showPlayButton = voiceEnabled && !isUser && message.text.length > 0;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-500 text-white rounded-br-md'
            : 'bg-[#1a1a1a] text-white rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <div className="flex items-center justify-between mt-1">
          <p
            className={`text-xs ${
              isUser ? 'text-blue-200' : 'text-[#a0a0a0]'
            }`}
          >
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
          {showPlayButton && (
            <button
              type="button"
              className="ml-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              onClick={handlePlay}
              aria-label={
                playState === 'playing' ? 'Stop audio' : 'Play audio'
              }
            >
              {playState === 'loading' && (
                <span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              )}
              {playState === 'playing' && '\u23F9'}
              {playState === 'idle' && '\uD83D\uDD0A'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
