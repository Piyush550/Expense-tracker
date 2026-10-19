import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2800);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" role="status" aria-live="polite" className={shown ? "show" : ""}>
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
