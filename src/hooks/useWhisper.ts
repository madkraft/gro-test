import { useCallback, useEffect, useRef, useState } from "react";

export type WhisperState = "idle" | "loading" | "ready" | "error";

export type WhisperModelInfo = {
  modelId: string;
  dtype: string;
  language: string;
};

type WorkerResponse =
  | { type: "loading"; progress: number; text: string }
  | {
      type: "ready";
      modelId: string;
      dtype: string;
      language: string;
    }
  | { type: "log"; message: string }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

export type UseWhisperOptions = {
  /** Appends worker pipeline lines (transcribe steps, etc.). */
  onLog?: (line: string) => void;
};

function createWorker() {
  return new Worker(
    new URL("../workers/whisper.worker.ts", import.meta.url),
    { type: "module" },
  );
}

export function useWhisper(options?: UseWhisperOptions) {
  const onLogRef = useRef(options?.onLog);
  onLogRef.current = options?.onLog;

  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<WhisperState>("idle");
  const [loadText, setLoadText] = useState("");
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [modelInfo, setModelInfo] = useState<WhisperModelInfo | null>(null);
  const resolveRef = useRef<((text: string) => void) | null>(null);
  const rejectRef = useRef<((err: Error) => void) | null>(null);

  const startWorker = useCallback(() => {
    workerRef.current?.terminate();

    const worker = createWorker();
    workerRef.current = worker;

    setState("loading");
    setLoadProgress(0);
    setLoadText("Starting…");
    setErrorMessage("");
    setModelInfo(null);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "loading") {
        setState("loading");
        setLoadText(msg.text);
        setLoadProgress(msg.progress);
      } else if (msg.type === "ready") {
        setState("ready");
        setLoadText("");
        setLoadProgress(100);
        setErrorMessage("");
        setModelInfo({
          modelId: msg.modelId,
          dtype: msg.dtype,
          language: msg.language,
        });
      } else if (msg.type === "log") {
        onLogRef.current?.(msg.message);
      } else if (msg.type === "result") {
        resolveRef.current?.(msg.text);
        resolveRef.current = null;
        rejectRef.current = null;
      } else if (msg.type === "error") {
        if (rejectRef.current) {
          rejectRef.current(new Error(msg.message));
          resolveRef.current = null;
          rejectRef.current = null;
        } else {
          setState("error");
          setErrorMessage(msg.message);
          setLoadText("");
        }
      }
    };

    worker.onerror = (e) => {
      setState("error");
      setErrorMessage(e.message ?? "Worker crashed");
      setLoadText("");
    };

    worker.postMessage({ type: "load" });
  }, []);

  useEffect(() => {
    startWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  // startWorker is stable (no deps), intentionally run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcribe = useCallback(
    (audio: Float32Array): Promise<string> =>
      new Promise((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker || state !== "ready") {
          reject(new Error("Model not ready yet"));
          return;
        }
        resolveRef.current = resolve;
        rejectRef.current = reject;
        worker.postMessage({ type: "transcribe", audio }, [audio.buffer]);
      }),
    [state],
  );

  return {
    state,
    loadText,
    loadProgress,
    errorMessage,
    modelInfo,
    transcribe,
    retry: startWorker,
  };
}
