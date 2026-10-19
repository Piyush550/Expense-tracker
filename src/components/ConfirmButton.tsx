import { useEffect, useState, type ReactNode } from "react";

/** A destructive button that needs a second click: "Delete" → "Confirm delete". */
export function ConfirmButton({
  children, confirmLabel, onConfirm, disabled, className = "btn small danger",
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? " on" : ""}`}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
