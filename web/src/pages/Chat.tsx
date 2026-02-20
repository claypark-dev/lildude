import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { ChatMessage } from '../components/ChatMessage.tsx';
import { useVoiceStatus } from '../hooks/useVoiceStatus.ts';
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
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamBufferRef = useRef('');

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
    }
  }, [lastMessage, streaming]);

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
          <ChatMessage key={msg.id} message={msg} voiceEnabled={voiceEnabled} />
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
