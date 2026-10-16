"use client";

import { CircleCheck } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const PublishConfirmationContext = createContext<{
  showPublishConfirmation: () => void;
  dismissPublishConfirmation: () => void;
} | null>(null);

export function PublishConfirmationProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissPublishConfirmation = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setVisible(false);
  }, []);

  const showPublishConfirmation = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setVisible(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setVisible(false);
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  const value = useMemo(() => ({ showPublishConfirmation, dismissPublishConfirmation }),
    [showPublishConfirmation, dismissPublishConfirmation]);

  return <PublishConfirmationContext.Provider value={value}>
    {children}
    <div className="admin-publish-confirmation" role="status" aria-live="polite" aria-atomic="true">
      {visible && <div className="admin-publish-toast">
        <CircleCheck size={22} aria-hidden />
        <div><strong>Published successfully</strong><p>The property is now live on the website.</p></div>
      </div>}
    </div>
  </PublishConfirmationContext.Provider>;
}

export function usePublishConfirmation() {
  const context = useContext(PublishConfirmationContext);
  if (!context) throw new Error("Publish confirmation requires the Admin provider.");
  return context;
}
