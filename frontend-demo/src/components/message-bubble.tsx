"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  status?: "sending" | "sent" | "error";
}

interface MessageBubbleProps {
  message: Message;
  isLast: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function MessageBubble({ message, isLast }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} px-4 py-0.5`}
    >
      <div
        className={`
          max-w-[75%] min-w-[60px] relative group
          ${isUser ? "message-bubble-user" : "message-bubble-bot"}
          px-4 py-2.5 shadow-sm
        `}
      >
        <div className={`text-sm leading-relaxed break-words ${isUser ? "text-[#e8eaed]" : "text-[#d4dde8]"}`}>
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-[#7eb8f7]">{children}</strong>,
                ul: ({ children }) => <ul className="list-none mt-1 mb-1 space-y-0.5">{children}</ul>,
                li: ({ children }) => <li className="flex gap-1.5"><span>•</span><span>{children}</span></li>,
                em: ({ children }) => <em className="italic">{children}</em>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        <div className={`flex items-center gap-1 mt-1 ${isUser ? "justify-end" : "justify-start"}`}>
          <span className="text-[10px] text-[#6b8aaa] leading-none">
            {formatTime(message.timestamp)}
          </span>
          {isUser && (
            <span className="text-[10px] leading-none">
              {message.status === "sending" && (
                <svg className="w-3 h-3 text-[#6b8aaa]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              )}
              {(message.status === "sent" || !message.status) && (
                <svg className="w-3.5 h-3.5 text-[#4fc3f7]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
                </svg>
              )}
              {message.status === "error" && (
                <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                </svg>
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
