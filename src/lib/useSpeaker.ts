"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/settings";

/**
 * Client-side TTS driver. Reads server settings to pick the backend
 * (soprano local / polly AWS), fetches audio blob, plays via a shared
 * <Audio> element. One active playback at a time.
 */
export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { settings: Settings }) => setSettings(d.settings))
      .catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }
    setSpeaking(false);
    setLoading(false);
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      const clean = text.trim();
      if (!clean || !settings) return;
      stop(); // cancel any prior playback

      const backend = settings.tts.backend;
      setLoading(true);
      try {
        let res: Response;
        if (backend === "polly") {
          const voice = settings.tts.pollyVoice;
          if (!voice) {
            console.warn("polly selected but no voice configured");
            setLoading(false);
            return;
          }
          res = await fetch("/api/tts/polly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, voice }),
          });
        } else {
          res = await fetch("/api/tts/soprano", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean }),
          });
        }
        if (!res.ok) {
          console.error("tts failed", res.status, await res.text());
          setLoading(false);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        currentUrlRef.current = url;

        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.addEventListener("ended", () => {
            setSpeaking(false);
            setLoading(false);
            if (currentUrlRef.current) {
              URL.revokeObjectURL(currentUrlRef.current);
              currentUrlRef.current = null;
            }
          });
          audioRef.current.addEventListener("error", () => {
            setSpeaking(false);
            setLoading(false);
          });
        }
        audioRef.current.src = url;
        setLoading(false);
        setSpeaking(true);
        await audioRef.current.play();
      } catch (e) {
        console.error("speak error", e);
        setSpeaking(false);
        setLoading(false);
      }
    },
    [settings, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { speak, stop, speaking, loading, ready: !!settings };
}
