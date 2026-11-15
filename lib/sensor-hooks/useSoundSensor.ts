"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { followRemote, pairingHeaders } from "../relay-client";
import type { SoundState } from "../sensors";

/** How often the level is measured and the reading refreshed. */
const MEASURE_MS = 200;
/** Length of each recording sent for speech-to-text. */
const CHUNK_MS = 4000;
/** A recording quieter than this throughout is not worth transcribing. */
const SPEECH_FLOOR_DB = -45;
const SILENCE_DB = -90;

function loudnessOf(db: number): SoundState["loudness"] {
  if (db < -45) return "quiet";
  if (db < -25) return "normal";
  if (db < -12) return "loud";
  return "very loud";
}

/**
 * Listens to a microphone. A reading holds how loud it is, measured on the device, and
 * the words heard in the last fifteen seconds, from short recordings sent for speech-to-text.
 */
export function useSoundSensor() {
  const [source, setSource] = useState<{ label: string; deviceId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [reading, setReading] = useState<SoundState | null>(null);
  /** Why words are not being picked up, when they aren't. Loudness still works. */
  const [speechNote, setSpeechNote] = useState<string | null>(null);

  const stateRef = useRef<SoundState | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const disconnect = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    stateRef.current = null;
    setReading(null);
    setSource(null);
  }, []);

  const connect = useCallback(
    async (deviceId?: string) => {
      // Browsers hide the microphone on pages that are not https (localhost excepted).
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("The microphone only works on an https page. On a phone, open the https link that `npm run dev` prints.");
        return;
      }
      disconnect();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          // Processing that evens out the volume would hide exactly what loudness rules look for.
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            autoGainControl: false,
            noiseSuppression: false,
            echoCancellation: false,
          },
        });
      } catch (caught) {
        const blocked = caught instanceof DOMException && caught.name === "NotAllowedError";
        setError(
          blocked
            ? "Microphone access was blocked. Allow it in the browser and try again."
            : `The microphone failed: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
        return;
      }

      const context = new AudioContext();
      // Some browsers leave a new audio context paused until asked, even after a tap.
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);

      let stopped = false;
      const levels: { at: number; db: number }[] = [];
      const heard: { at: number; text: string }[] = [];
      let chunkPeak = SILENCE_DB;
      let canTranscribe = true;

      const measure = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const db = Math.max(SILENCE_DB, 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-9));
        const now = Date.now();
        levels.push({ at: now, db });
        while (levels[0].at < now - 3000) levels.shift();
        while (heard.length > 0 && heard[0].at < now - 15_000) heard.shift();
        chunkPeak = Math.max(chunkPeak, db);

        const latest = levels.filter((level) => level.at >= now - 600);
        const current = latest.reduce((total, level) => total + level.db, 0) / latest.length;
        const next: SoundState = {
          loudness: loudnessOf(current),
          loudness_db: Math.round(current),
          peak_db_last_3_seconds: Math.round(Math.max(...levels.map((level) => level.db))),
          heard_in_last_15_seconds: heard.map((item) => item.text).join(" "),
        };
        stateRef.current = next;
        setReading(next);
      }, MEASURE_MS);

      const transcribe = async (audio: Blob) => {
        const form = new FormData();
        form.append("audio", audio);
        try {
          const response = await fetch("/api/transcribe", { method: "POST", headers: pairingHeaders(), body: form });
          const body = await response.json();
          if (stopped) return;
          if (response.status === 501 || response.status === 401) {
            // No usable key: stop recording, since nothing can be done with it.
            canTranscribe = false;
            setSpeechNote(body.error);
          } else if (response.ok) {
            setSpeechNote(null);
            if (body.text) heard.push({ at: Date.now(), text: body.text });
          }
        } catch {
          // A dropped request loses one recording; the next one is tried as usual.
        }
      };

      // Each recording is stopped and a new one started, so every upload is a complete file.
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find(
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
      );
      let recorder: MediaRecorder | null = null;
      let chunkTimer: ReturnType<typeof setTimeout> | undefined;
      const recordChunk = () => {
        if (stopped || !canTranscribe || !mimeType) return;
        const parts: Blob[] = [];
        chunkPeak = SILENCE_DB;
        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (event) => parts.push(event.data);
        recorder.onstop = () => {
          const peak = chunkPeak;
          recordChunk();
          if (!stopped && peak >= SPEECH_FLOOR_DB) void transcribe(new Blob(parts, { type: mimeType }));
        };
        recorder.start();
        chunkTimer = setTimeout(() => recorder?.state === "recording" && recorder.stop(), CHUNK_MS);
      };
      if (mimeType) recordChunk();
      else setSpeechNote("This browser cannot record audio for speech-to-text, so only loudness is measured.");

      const track = stream.getAudioTracks()[0];
      track?.addEventListener("ended", () => disconnect());
      stopRef.current = () => {
        stopped = true;
        clearInterval(measure);
        clearTimeout(chunkTimer);
        if (recorder?.state === "recording") recorder.stop();
        stream.getTracks().forEach((item) => item.stop());
        void context.close();
      };

      setSource({ label: track?.label || "Microphone", deviceId: track?.getSettings().deviceId });
      setError(null);
      setSpeechNote(null);
      // Device names are only readable once microphone access has been granted.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    },
    [disconnect],
  );

  // Stops the source when the page goes away. A code reload during development can run this too
  // while keeping the state, so the source is also forgotten: better shown as off than as on and silent.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
      setSource(null);
    },
    [],
  );

  /** Listens through another device's microphone, such as a phone's, from the readings it sends through the relay. */
  const connectRemote = useCallback(
    (channel: string, label: string) => {
      disconnect();
      stopRef.current = followRemote<SoundState>(channel, "sound", (state) => {
        stateRef.current = state;
        setReading(state);
      });
      setSource({ label });
      setError(null);
      setSpeechNote(null);
    },
    [disconnect],
  );

  const getState = useCallback(() => stateRef.current, []);

  return { connected: source !== null, source, error, microphones, reading, speechNote, connect, connectRemote, disconnect, getState };
}
