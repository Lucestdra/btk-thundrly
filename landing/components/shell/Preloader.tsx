"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function Preloader() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShow(false), 1300);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="preloader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg-primary"
          aria-hidden="true"
        >
          <AnimatedLogoMark />
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
            className="mt-6 font-display text-2xl font-normal tracking-tight text-ink"
          >
            Tartı
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 0.2, duration: 1.0, ease: "easeInOut" }}
            style={{ originX: 0 }}
            className="mt-8 h-px w-32 bg-cerulean/40"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AnimatedLogoMark() {
  const inputs = [9, 16.5, 23.5, 31];
  return (
    <svg
      viewBox="0 0 40 40"
      className="h-16 w-16 text-ink"
      fill="none"
      aria-hidden="true"
    >
      {inputs.map((y, i) => (
        <motion.line
          key={`l-${y}`}
          x1="11.5"
          y1={y}
          x2="29"
          y2="20"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeWidth="1.3"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.28 + i * 0.06, duration: 0.4 }}
        />
      ))}
      {inputs.map((y, i) => (
        <motion.circle
          key={`d-${y}`}
          cy={y}
          r="2.1"
          fill="currentColor"
          initial={{ opacity: 0, cx: 4 }}
          animate={{ opacity: 1, cx: 11 }}
          transition={{ delay: i * 0.07, duration: 0.35, ease: "easeOut" }}
        />
      ))}
      <motion.circle
        cx="29"
        cy="20"
        className="fill-accent"
        initial={{ r: 0, opacity: 0 }}
        animate={{ r: 5, opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.4 }}
      />
    </svg>
  );
}
