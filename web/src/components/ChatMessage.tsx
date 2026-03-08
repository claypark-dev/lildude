import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage as ChatMessageType } from '../lib/types.ts';
import { synthesizeSpeech } from '../lib/api.ts';
import { FeedbackButtons } from './FeedbackButtons.tsx';
import { ArtifactRenderer } from './ArtifactRenderer.tsx';
import { parseMessageContent } from '../lib/artifact-parser.ts';

interface ChatMessageProps {
  message: ChatMessageType;
  voiceEnabled?: boolean;
  /** Whether this message is currently being auto-spoken. */
  autoSpeaking?: boolean;
  /** Optional task ID for associating feedback. */
  taskId?: string;
}

/** TTS playback state */
type PlayState = 'idle' | 'loading' | 'playing';

/** Single chat message bubble with optional TTS play button and feedback for assistant messages */
export function ChatMessage({ message, voiceEnabled = false, autoSpeaking = false, taskId }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [speechError, setSpeechError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Parse message content for artifacts (memoized to avoid re-parsing on every render)
  const parsed = useMemo(() => parseMessageContent(message.text), [message.text]);

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
    setSpeechError(false);

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
      setSpeechError(true);
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
        {/* Render message content — either plain text or interleaved text + artifacts */}
        <div>
          {autoSpeaking && (
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse mr-2 align-middle" />
          )}
          {parsed.hasArtifacts ? (
            // Rich rendering with artifact blocks
            parsed.blocks.map((block, i) =>
              block.type === 'text' ? (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {block.content}
                </p>
              ) : (
                <ArtifactRenderer key={i} block={block} />
              ),
            )
          ) : (
            // Plain text fallback (original behavior)
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <p
            className={`text-xs ${
              isUser ? 'text-blue-200' : 'text-[#a0a0a0]'
            }`}
          >
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
          <span className="flex items-center gap-2">
            {!isUser && <FeedbackButtons taskId={taskId} />}
            {showPlayButton && (
              <button
                type="button"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                onClick={handlePlay}
                aria-label={
                  playState === 'playing' ? 'Stop audio' : 'Play audio'
                }
              >
                {playState === 'loading' && (
                  <span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
                {playState === 'playing' && '\u23F9'}
                {playState === 'idle' && !speechError && '\uD83D\uDD0A'}
                {playState === 'idle' && speechError && (
                  <span title="Speech synthesis failed">!</span>
                )}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
