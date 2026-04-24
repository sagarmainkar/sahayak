"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Themed in-app replacement for `window.confirm` — Promise-returning
 * imperative API so call sites stay terse:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: "Delete this chat?" }))) return;
 *
 * Mount <ConfirmDialogProvider> once near the root; `useConfirm()`
 * anywhere below it returns the prompter. Resolves `true` on confirm,
 * `false` on cancel / Escape / backdrop click. Only one dialog is
 * rendered at a time; a second call while another is open queues.
 */

export type ConfirmOptions = {
  /** Body text. Required. */
  message: string;
  /** Optional title above the message; defaults to "Confirm". */
  title?: string;
  /** Confirm button label; defaults to "Confirm" (or "Delete" in danger). */
  confirmLabel?: string;
  /** Cancel button label; defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone. "danger" colours the confirm button red + adds a
   *  trash icon; "default" is neutral. */
  tone?: "default" | "danger";
};

type Pending = {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
};

type Ctx = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<Ctx | null>(null);

export function useConfirm(): Ctx {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      "useConfirm() must be used inside <ConfirmDialogProvider>",
    );
  }
  return ctx;
}

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Queue so two near-simultaneous confirms don't clobber each other.
  const [queue, setQueue] = useState<Pending[]>([]);
  const current = queue[0] ?? null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const prompt = useCallback<Ctx>((raw) => {
    const opts: ConfirmOptions =
      typeof raw === "string" ? { message: raw } : raw;
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { opts, resolve }]);
    });
  }, []);

  const resolveCurrent = useCallback(
    (ok: boolean) => {
      if (!current) return;
      current.resolve(ok);
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  return (
    <ConfirmContext.Provider value={prompt}>
      {children}
      {mounted &&
        current &&
        createPortal(
          <Dialog
            opts={current.opts}
            onConfirm={() => resolveCurrent(true)}
            onCancel={() => resolveCurrent(false)}
          />,
          document.body,
        )}
    </ConfirmContext.Provider>
  );
}

function Dialog({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { title, message, confirmLabel, cancelLabel, tone } = opts;
  const isDanger = tone === "danger";
  const confirmText =
    confirmLabel ?? (isDanger ? "Delete" : "Confirm");
  const cancelText = cancelLabel ?? "Cancel";
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // Autofocus the confirm button so Enter submits immediately.
  useEffect(() => {
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  // Keyboard: Escape cancels, Enter confirms (button is focused so
  // the second is native behaviour; we only need Escape).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        // Backdrop click cancels; clicks inside the card shouldn't.
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="mx-4 w-full max-w-[380px] rounded-lg border border-border bg-bg-paper p-5 shadow-[var(--shadow)]">
        <div className="mb-3 flex items-center gap-2.5">
          {isDanger ? (
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
          ) : null}
          <h2
            id="confirm-title"
            className="font-display text-[17px] italic leading-tight text-fg"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}
          >
            {title ?? (isDanger ? "Confirm deletion" : "Confirm")}
          </h2>
        </div>
        <p className="mb-5 font-serif text-[14px] leading-[1.55] text-fg">
          {message}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-bg px-3 py-1.5 font-sans text-[12px] text-fg-muted hover:border-accent hover:text-fg"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-sans text-[12px] font-medium text-white",
              isDanger
                ? "bg-red-500/90 hover:bg-red-500"
                : "bg-accent hover:opacity-90",
            )}
          >
            {isDanger && <Trash2 className="h-3.5 w-3.5" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
