import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { ChatMessage } from '../components/ChatMessage.tsx';
import { useVoiceStatus } from '../hooks/useVoiceStatus.ts';
import { useAudioQueue } from '../hooks/useAudioQueue.ts';
import { VoiceActivityIndicator } from '../components/VoiceActivityIndicator.tsx';
import { previewVoice } from '../lib/api.ts';
import type { ChatMessage as ChatMessageType } from '../lib/types.ts';

let messageIdCounter = 0;

function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}-${Date.now()}`;
}

/** Chat page with WebSocket-based messaging and streaming responses */
export function Chat() {
  const { connected, lastMessage, send } = useWebSocket();
  const { enabled: voiceEnabled } = useVoiceStatus();
  const audioQueue = useAudioQueue();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [autoSpeakLocal, setAutoSpeakLocal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamBufferRef = useRef('');
  const spokenIdsRef = useRef<Set<string>>(new Set());

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'message': {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            text: lastMessage.text,
            role: 'assistant',
            timestamp: Date.now(),
          },
        ]);
        setStreaming(false);
        break;
      }
      case 'stream_chunk': {
        streamBufferRef.current += lastMessage.text;
        setStreaming(true);
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && streaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, text: streamBufferRef.current },
            ];
          }
          return [
            ...prev,
            {
              id: nextMessageId(),
              text: streamBufferRef.current,
              role: 'assistant',
              timestamp: Date.now(),
            },
          ];
        });
        break;
      }
      case 'stream_end': {
        streamBufferRef.current = '';
        setStreaming(false);
        break;
      }
      case 'history': {
        // Populate messages from server history on connect/reconnect
        if (lastMessage.messages.length > 0) {
          const historyMsgs = lastMessage.messages.map((m) => ({
            id: `hist-${m.id}`,
            text: m.text,
            role: m.role as 'user' | 'assistant',
            timestamp: m.timestamp,
          }));
          setMessages((prev) => {
            // Deduplicate by checking existing message IDs
            const existingIds = new Set(prev.map((p) => p.id));
            const newMsgs = historyMsgs.filter((m) => !existingIds.has(m.id));
            if (prev.length === 0) return newMsgs;
            return [...newMsgs, ...prev];
          });
        }
        break;
      }
    }
  }, [lastMessage, streaming]);

  // Auto-speak new assistant messages when enabled
  const autoSpeakMessage = useCallback(async (msg: ChatMessageType) => {
    if (!autoSpeakLocal || msg.role !== 'assistant' || !msg.text.trim()) return;
    if (spokenIdsRef.current.has(msg.id)) return;
    spokenIdsRef.current.add(msg.id);
    try {
      const blob = await previewVoice(msg.text.slice(0, 500));
      audioQueue.enqueue(blob, msg.id);
    } catch {
      // Silently skip if TTS fails
    }
  }, [autoSpeakLocal, audioQueue]);

  // Trigger auto-speak on new complete messages (not during streaming)
  useEffect(() => {
    if (streaming || !autoSpeakLocal || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      autoSpeakMessage(lastMsg);
    }
  }, [messages, streaming, autoSpeakLocal, autoSpeakMessage]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || !connected) return;

    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        text: trimmed,
        role: 'user',
        timestamp: Date.now(),
      },
    ]);

    send({ type: 'chat', text: trimmed });
    setInputText('');
    streamBufferRef.current = '';
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">Chat</h2>
        <div className="flex items-center gap-3">
          {voiceEnabled && (
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                autoSpeakLocal
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-[#1a1a1a] text-[#888] border border-[#333] hover:text-white'
              }`}
              onClick={() => {
                if (autoSpeakLocal) audioQueue.stop();
                setAutoSpeakLocal((v) => !v);
              }}
              aria-label={autoSpeakLocal ? 'Disable auto-speak' : 'Enable auto-speak'}
            >
              {autoSpeakLocal ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
              {autoSpeakLocal ? 'Speaking' : 'Muted'}
              <VoiceActivityIndicator active={audioQueue.playing} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-[#a0a0a0]">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto bg-[#111] rounded-xl border border-[#222] p-4 mb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500 text-sm">
              Send a message to start a conversation
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            voiceEnabled={voiceEnabled}
            autoSpeaking={audioQueue.currentId === msg.id}
          />
        ))}
        {streaming && (
          <div className="flex justify-start mb-3">
            <div className="px-4 py-2 bg-[#1a1a1a] rounded-2xl rounded-bl-md">
              <span className="text-blue-400 text-sm animate-pulse">
                ...
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-3">
        <textarea
          className="flex-1 bg-[#111] border border-[#222] rounded-xl px-4 py-3 text-white text-sm
                     placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50
                     focus:border-blue-500"
          placeholder={connected ? 'Type a message...' : 'Connecting...'}
          rows={2}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected}
        />
        <button
          type="button"
          className="px-6 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a] disabled:text-slate-500
                     text-slate-900 font-semibold rounded-xl transition-colors self-end py-3"
          onClick={handleSend}
          disabled={!connected || !inputText.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
