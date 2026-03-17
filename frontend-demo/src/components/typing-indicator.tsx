"use client";

import { motion } from "framer-motion";

const dotVariants = {
  initial: { scale: 0.8, opacity: 0.4 },
  animate: { scale: 1.2, opacity: 1 },
};

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.2,
      repeat: Infinity,
      repeatType: "mirror" as const,
    },
  },
};

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-2 px-4 py-1">
      <div className="message-bubble-bot px-4 py-3 flex items-center gap-1.5 shadow-sm">
        <motion.div
          className="flex items-center gap-1.5"
          variants={containerVariants}
          animate="animate"
          initial="initial"
        >
          <motion.span
            className="typing-dot"
            variants={dotVariants}
            transition={{ duration: 0.4, ease: "easeInOut" }}
          />
          <motion.span
            className="typing-dot"
            variants={dotVariants}
            transition={{ duration: 0.4, ease: "easeInOut", delay: 0.2 }}
          />
          <motion.span
            className="typing-dot"
            variants={dotVariants}
            transition={{ duration: 0.4, ease: "easeInOut", delay: 0.4 }}
          />
        </motion.div>
      </div>
    </div>
  );
}
