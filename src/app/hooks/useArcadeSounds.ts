"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SoundName =
  | "roundAnnounce"
  | "choosing"
  | "reveal"
  | "clash"
  | "ko"
  | "winner"
  | "draw";

interface SoundStep {
  freq: number;
  duration: number;
  type?: OscillatorType;
}

interface SoundDef {
  freq: number;
  type: OscillatorType;
  duration: number;
  ramp?: number;
  gain?: number;
  sequence?: SoundStep[];
}

const SOUNDS: Record<SoundName, SoundDef> = {
  roundAnnounce: { freq: 880, type: "square", duration: 0.12, gain: 0.15, sequence: [
    { freq: 660, duration: 0.08 },
    { freq: 880, duration: 0.12 },
  ]},
  choosing: { freq: 220, type: "square", duration: 0.05, gain: 0.08 },
  reveal: { freq: 1200, type: "square", duration: 0.08, ramp: 600, gain: 0.12 },
  clash: { freq: 150, type: "sawtooth", duration: 0.15, ramp: 40, gain: 0.2 },
  ko: { freq: 100, type: "sawtooth", duration: 0.25, ramp: 30, gain: 0.2 },
  winner: { freq: 523, type: "square", duration: 0.3, gain: 0.15, sequence: [
    { freq: 523, duration: 0.1 },
    { freq: 659, duration: 0.1 },
    { freq: 784, duration: 0.15 },
  ]},
  draw: { freq: 440, type: "triangle", duration: 0.2, ramp: 330, gain: 0.12 },
};

const STORAGE_KEY = "arena-sound-muted";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface ArcadeSounds {
  play: (sound: SoundName) => void;
  muted: boolean;
  toggleMute: () => void;
}

export function useArcadeSounds(): ArcadeSounds {
  const [muted, setMuted] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setMuted(stored !== "false");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      if (ctxRef.current?.state !== "closed") {
        ctxRef.current?.close();
      }
    };
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctxRef.current = new AC();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === "suspended") {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (sound: SoundName) => {
      if (muted || prefersReducedMotion()) return;
      const ctx = getCtx();
      if (!ctx) return;

      const def = SOUNDS[sound];
      const baseGain = def.gain ?? 0.15;

      if (def.sequence && def.sequence.length > 0) {
        let offset = 0;
        for (const step of def.sequence) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = step.type ?? def.type;
          osc.frequency.setValueAtTime(step.freq, ctx.currentTime + offset);
          g.gain.setValueAtTime(baseGain, ctx.currentTime + offset);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + step.duration);
          osc.connect(g).connect(ctx.destination);
          osc.start(ctx.currentTime + offset);
          osc.stop(ctx.currentTime + offset + step.duration);
          offset += step.duration;
        }
        return;
      }

      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = def.type;
      osc.frequency.setValueAtTime(def.freq, ctx.currentTime);
      if (def.ramp) {
        osc.frequency.exponentialRampToValueAtTime(def.ramp, ctx.currentTime + def.duration);
      }
      g.gain.setValueAtTime(baseGain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + def.duration);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + def.duration);
    },
    [muted, getCtx],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      if (!next) {
        const ctx = getCtx();
        if (ctx?.state === "suspended") void ctx.resume();
      }
      return next;
    });
  }, [getCtx]);

  return { play, muted, toggleMute };
}
