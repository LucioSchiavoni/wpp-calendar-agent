"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, RotateCcw } from "lucide-react";
import { MessageBubble, type Message } from "@/components/message-bubble";
import { TypingIndicator } from "@/components/typing-indicator";

export interface ChatInterfaceProps {
  businessId: string;
  businessName: string;
  businessServices: Array<{ name: string; duration_minutes: number; price: number }>;
  welcomeMessage?: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

function createSessionId(): string {
  const id = crypto.randomUUID();
  sessionStorage.setItem("chat_session_id", id);
  return id;
}

function getOrCreateSessionId(): string {
  return sessionStorage.getItem("chat_session_id") ?? createSessionId();
}

export function ChatInterface({ businessId, businessName, businessServices, welcomeMessage }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [sendAnimating, setSendAnimating] = useState(false);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    if (!welcomeMessage) return;
    const welcome: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: welcomeMessage,
      timestamp: new Date(),
      status: "sent",
    };
    setMessages([welcome]);
  }, [welcomeMessage]);

  const startNewConversation = useCallback(() => {
    setSessionId(createSessionId());
    setMessages(
      welcomeMessage
        ? [{ id: crypto.randomUUID(), role: "assistant", content: welcomeMessage, timestamp: new Date(), status: "sent" }]
        : []
    );
    setInput("");
    setIsTyping(false);
  }, [welcomeMessage]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || isTyping || !sessionId) return;

    setInput("");
    setSendAnimating(true);
    setTimeout(() => setSendAnimating(false), 300);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
      status: "sending",
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, sessionId, message: content }),
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === userMsg.id ? { ...m, status: "sent" } : m))
      );

      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      const botMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response || "Lo siento, no pude procesar tu mensaje.",
        timestamp: new Date(),
        status: "sent",
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === userMsg.id ? { ...m, status: "error" } : m))
      );

      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Lo siento, hubo un error al conectarme. Por favor intentá de nuevo.",
        timestamp: new Date(),
        status: "sent",
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, sessionId, businessId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="flex flex-col h-screen w-full max-w-2xl mx-auto bg-[#0e1621]">
      <header className="flex items-center gap-3 px-4 py-3 bg-[#17212b] border-b border-[#1f2d3d] shadow-md z-10 flex-shrink-0">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2b5278] to-[#1a3a5c] flex items-center justify-center shadow-md">
            <Bot className="w-5 h-5 text-[#7eb8f7]" />
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#4dca6d] border-2 border-[#17212b]" />
        </div>

        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-[#e8eaed] text-sm leading-tight truncate">
            {businessName}
          </span>
          <span className="text-[11px] text-[#4dca6d] leading-tight">En línea</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {businessServices.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end max-w-[200px]">
              {businessServices.slice(0, 3).map((s) => (
                <span
                  key={s.name}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[#1f2d3d] text-[#8b9ab1] border border-[#2b3f55] truncate max-w-[90px]"
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
          <motion.button
            onClick={startNewConversation}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            title="Nueva conversación"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#8b9ab1] hover:text-[#7eb8f7] hover:bg-[#1f2d3d] transition-colors"
          >
            <RotateCcw className="w-4 h-4" strokeWidth={2} />
          </motion.button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-4 space-y-0.5 chat-bg-pattern"
        style={{ scrollBehavior: "smooth" }}
      >
        <AnimatePresence initial={false}>
          {messages.length === 0 && !isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full gap-3 text-center px-6"
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#2b5278] to-[#1a3a5c] flex items-center justify-center shadow-lg">
                <Bot className="w-8 h-8 text-[#7eb8f7]" />
              </div>
              <div>
                <p className="text-[#e8eaed] font-semibold text-lg">{businessName}</p>
                <p className="text-[#8b9ab1] text-sm mt-1">Enviá un mensaje para comenzar</p>
              </div>
            </motion.div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={idx === messages.length - 1}
            />
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            <TypingIndicator />
          </motion.div>
        )}

        <div className="h-2" />
      </div>

      <div className="flex-shrink-0 bg-[#17212b] border-t border-[#1f2d3d] px-3 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-[#0e1621] rounded-2xl border border-[#1f2d3d] px-4 py-2.5 flex items-end gap-2 focus-within:border-[#2b5278] transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje..."
              rows={1}
              disabled={isTyping}
              className="flex-1 bg-transparent text-[#e8eaed] text-sm placeholder-[#4a6080] outline-none resize-none max-h-[120px] leading-relaxed disabled:opacity-50"
              style={{ minHeight: "22px" }}
            />
          </div>

          <motion.button
            onClick={sendMessage}
            disabled={!input.trim() || isTyping}
            animate={sendAnimating ? { scale: [1, 0.85, 1.1, 1] } : {}}
            transition={{ duration: 0.3 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            className="w-10 h-10 rounded-full bg-[#2b5278] hover:bg-[#3466a0] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-md transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4 text-white" strokeWidth={2} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
