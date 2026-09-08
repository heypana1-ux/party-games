"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, RefreshCw } from "lucide-react";
import { quick } from "@/components/motion/presets";
import type { ConnectionStatus } from "@/platform/session/types";

/*
  Connection state, stated plainly.

  The app does not queue moves made while offline. A tap that lands thirty
  seconds late in a live game is worse than a tap that never happened, so the
  honest thing is to say the connection is gone and disable the controls.
*/
export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  const visible = status === "reconnecting" || status === "offline";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={quick}
          role="status"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warn/90 py-2 text-sm font-medium text-[#1a1206] pt-safe"
        >
          {status === "offline" ? (
            <>
              <CloudOff className="h-4 w-4" /> No connection
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" /> Reconnecting…
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
