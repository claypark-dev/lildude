import type { ChatMessage as ChatMessageType } from '../lib/types.ts';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** Single chat message bubble, styled differently for user vs assistant */
export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

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
        <p
          className={`text-xs mt-1 ${
            isUser ? 'text-blue-200' : 'text-[#a0a0a0]'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
