"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type VideoSource = {
  kind: "camera" | "screen" | "file";
  label: string;
  /** Set for cameras, so the picker can show which one is active. */
  deviceId?: string;
};

function describe(error: unknown, what: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return `${what} was blocked or cancelled. Allow it in the browser and try again.`;
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return `No ${what.toLowerCase()} was found.`;
  }
  return `${what} failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Connects a camera, a shared screen or tab, or a video file to one <video> element.
 * Everything downstream reads frames from that element, so all three behave the same.
 */
export function useVideoSource(videoRef: RefObject<HTMLVideoElement | null>) {
  const [source, setSource] = useState<VideoSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const fileUrlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
  }, [videoRef]);

  const disconnect = useCallback(() => {
    release();
    setSource(null);
  }, [release]);

  const attachStream = useCallback(
    async (stream: MediaStream, next: VideoSource) => {
      release();
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      // Fires when the camera is unplugged or the user clicks the browser's "Stop sharing".
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streamRef.current === stream) disconnect();
      });
      setSource(next);
      setError(null);
    },
    [release, disconnect, videoRef],
  );

  const connectCamera = useCallback(
    async (deviceId?: string) => {
      // Browsers hide the camera API on pages that are not https (localhost excepted).
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("The camera only works on an https page. On a phone, open the https link that `npm run dev` prints.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : // On a phone this picks the back camera; a laptop has only one and ignores it.
              { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
        });
        const track = stream.getVideoTracks()[0];
        await attachStream(stream, {
          kind: "camera",
          label: track?.label || "Camera",
          deviceId: track?.getSettings().deviceId,
        });
        // Device names are only readable once camera access has been granted.
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((device) => device.kind === "videoinput"));
      } catch (caught) {
        setError(describe(caught, "Camera"));
      }
    },
    [attachStream],
  );

  const connectScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      await attachStream(stream, { kind: "screen", label: track?.label || "Shared screen" });
    } catch (caught) {
      setError(describe(caught, "Screen sharing"));
    }
  }, [attachStream]);

  const connectFile = useCallback(
    async (file: File) => {
      release();
      const video = videoRef.current;
      if (!video) return;
      const url = URL.createObjectURL(file);
      fileUrlRef.current = url;
      video.src = url;
      video.loop = true;
      try {
        await video.play();
        setSource({ kind: "file", label: file.name });
        setError(null);
      } catch (caught) {
        release();
        setSource(null);
        setError(describe(caught, "Video file"));
      }
    },
    [release, videoRef],
  );

  // Releases the source when the page goes away. During development the same effect also runs again
  // when the code reloads, with `source` kept but the stream released by the cleanup, which would leave
  // a camera that says it is connected and shows nothing. So on the way back in, a camera is started
  // again, and a source that needs a click (a shared screen, a file) is forgotten.
  const latest = useRef({ source, release, connectCamera });
  latest.current = { source, release, connectCamera };
  useEffect(() => {
    const { source: kept, connectCamera: reconnect } = latest.current;
    if (kept && !streamRef.current && !fileUrlRef.current) {
      if (kept.kind === "camera") void reconnect(kept.deviceId);
      else setSource(null);
    }
    return () => latest.current.release();
  }, []);

  // Phones cannot share their screen. Checked after mount so server and client render the same first page.
  const [canShareScreen, setCanShareScreen] = useState(true);
  useEffect(() => {
    setCanShareScreen(Boolean(navigator.mediaDevices?.getDisplayMedia));
  }, []);

  // Keeps a phone awake while it is acting as the camera; otherwise it locks and the video stops.
  useEffect(() => {
    if (!source || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) void lock.release();
      } catch {
        // Refused, for example in low power mode: the screen may sleep.
      }
    };
    // The lock is dropped whenever the page is hidden, so take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [source]);

  return { source, error, cameras, canShareScreen, connectCamera, connectScreen, connectFile, disconnect };
}
