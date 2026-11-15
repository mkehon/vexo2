"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type VideoSource = {
  /** "remote" is another device's camera, arriving through the relay. */
  kind: "camera" | "screen" | "file" | "remote";
  label: string;
  /** Set for cameras, so the picker can show which one is active. */
  deviceId?: string;
  /**
   * Counts the streams this slot has had. A camera that is connected again has the same name
   * but a new stream, and anything showing a copy of the old one has to switch to it.
   */
  epoch?: number;
};

function describe(error: unknown, what: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return `${what} was blocked or cancelled. Allow it in the browser and try again.`;
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return `No ${what.toLowerCase()} was found.`;
  }
  if (error instanceof DOMException && error.name === "NotReadableError" && what === "Screen sharing") {
    // What a Mac answers when the browser itself is not allowed to record the screen.
    return "The browser could not capture that. Sharing a tab always works; to share a window or the whole screen on a Mac, allow the browser under System Settings, Privacy & Security, Screen & System Audio Recording.";
  }
  return `${what} failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Connects a camera, a shared screen or tab, or a video file to one <video> element.
 * Everything downstream reads frames from that element, so all three behave the same.
 * Each `connect…` resolves to whether it connected; when it did not, `error` says why.
 */
export function useVideoSource(videoRef: RefObject<HTMLVideoElement | null>) {
  const [source, setSource] = useState<VideoSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const epochRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  /** Stops the loop that fetches a remote camera's frames. */
  const remoteStopRef = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    remoteStopRef.current?.();
    remoteStopRef.current = null;
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
      setSource({ ...next, epoch: (epochRef.current += 1) });
      setError(null);
    },
    [release, disconnect, videoRef],
  );

  const connectCamera = useCallback(
    async (deviceId?: string) => {
      // Browsers hide the camera API on pages that are not https (localhost excepted).
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("The camera only works on an https page. On a phone, open the https link that `npm run dev` prints.");
        return false;
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
        return true;
      } catch (caught) {
        setError(describe(caught, "Camera"));
        return false;
      }
    },
    [attachStream],
  );

  /**
   * Shows another device's camera, such as a phone's, from the frames it sends through the
   * relay. They are drawn onto a canvas, and the canvas is the stream, so everything
   * downstream treats it like a camera plugged into this computer.
   */
  const connectRemote = useCallback(
    async (channel: string, label: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      if (!context || !canvas.captureStream) {
        setError("This browser cannot show a camera from another device.");
        return false;
      }
      // Until the first frame arrives, the picture says what it is waiting for.
      const waiting = () => {
        context.fillStyle = "#17181A";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#FFFFFF";
        context.textAlign = "center";
        context.font = "600 26px system-ui, sans-serif";
        context.fillText(`Waiting for ${label}`, canvas.width / 2, canvas.height / 2 - 8);
        context.font = "18px system-ui, sans-serif";
        context.fillStyle = "#FFFFFFAA";
        context.fillText("Open the link on it and turn on its camera", canvas.width / 2, canvas.height / 2 + 24);
      };
      waiting();

      let stopped = false;
      let seq = 0;
      let lastFrameAt = 0;
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const follow = async () => {
        while (!stopped) {
          try {
            const response = await fetch(`/api/relay?channel=${channel}&kind=camera&after=${seq}`);
            if (response.status === 200) {
              seq = Number(response.headers.get("x-seq")) || seq + 1;
              const picture = await createImageBitmap(await response.blob());
              if (stopped) return picture.close();
              if (canvas.width !== picture.width || canvas.height !== picture.height) {
                canvas.width = picture.width;
                canvas.height = picture.height;
              }
              context.drawImage(picture, 0, 0);
              picture.close();
              lastFrameAt = Date.now();
            } else if (response.status === 204) {
              // Nothing new. Once the phone has been quiet for a while, say so instead of freezing on its last picture.
              if (lastFrameAt && Date.now() - lastFrameAt > 5000) {
                lastFrameAt = 0;
                seq = 0;
                waiting();
              }
            } else {
              await pause(1500);
            }
          } catch {
            await pause(1500);
          }
        }
      };

      await attachStream(canvas.captureStream(15), { kind: "remote", label });
      remoteStopRef.current = () => {
        stopped = true;
      };
      void follow();
      return true;
    },
    [attachStream],
  );

  const connectScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      await attachStream(stream, { kind: "screen", label: track?.label || "Shared screen" });
      return true;
    } catch (caught) {
      setError(describe(caught, "Screen sharing"));
      return false;
    }
  }, [attachStream]);

  const connectFile = useCallback(
    async (file: File) => {
      release();
      const video = videoRef.current;
      if (!video) return false;
      const url = URL.createObjectURL(file);
      fileUrlRef.current = url;
      video.src = url;
      video.loop = true;
      try {
        await video.play();
        setSource({ kind: "file", label: file.name, epoch: (epochRef.current += 1) });
        setError(null);
        return true;
      } catch (caught) {
        release();
        setSource(null);
        setError(describe(caught, "Video file"));
        return false;
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

  return { source, error, cameras, canShareScreen, connectCamera, connectScreen, connectFile, connectRemote, disconnect };
}
