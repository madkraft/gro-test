import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, type SubmitEvent } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import type { GroceryItem } from "../types/grocery";

const PROCESS_AUDIO_PATH = "/.netlify/functions/process-audio";

type AiRow = { item: string; category?: string };

function rowsToItems(rows: AiRow[]): GroceryItem[] {
  const now = new Date().toISOString();
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    item: row.item,
    category:
      typeof row.category === "string" && row.category.trim() !== ""
        ? row.category
        : "❓ Inne",
    bought: false,
    createdAt: now,
  }));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:audio/webm;base64,")
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const Route = createFileRoute("/input")({
  component: InputPage,
});

function InputPage() {
  const { items, updateList, isOnline } = useGroceryList();

  const [pipelineLog, setPipelineLog] = useState<string[]>([]);
  const logPipeline = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setPipelineLog((prev) => [...prev.slice(-50), `${stamp} ${line}`]);
  }, []);

  const [status, setStatus] = useState("");
  const [lastAdded, setLastAdded] = useState<AiRow[] | null>(null);
  const [listText, setListText] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const holdingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const hasSpokenRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const submitToGemini = useCallback(
    async (opts: { text?: string; audioData?: string; mimeType?: string }): Promise<boolean> => {
      const isAudio = !!opts.audioData;
      logPipeline(isAudio ? "Sending audio to Gemini…" : "Sending text to Gemini…");
      setStatus("Processing…");
      try {
        const response = await fetch(PROCESS_AUDIO_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });
        logPipeline(`Gemini responded HTTP ${String(response.status)}.`);
        const payloadJson = (await response.json()) as {
          success?: boolean;
          error?: string;
          items?: unknown;
          model?: string;
        };
        if (payloadJson.model && payloadJson.model !== "gemini-2.5-flash") {
          logPipeline(`⚠️ gemini-2.5-flash unavailable — retried with ${payloadJson.model}.`);
        }
        if (!response.ok || payloadJson.success === false) {
          logPipeline(`Gemini step failed: ${payloadJson.error ?? "unknown error"}.`);
          setLastAdded(null);
          setStatus(payloadJson.error ?? "Error parsing list.");
          return false;
        }
        const raw = payloadJson.items;
        const nextRows = Array.isArray(raw)
          ? raw.filter(
              (row): row is AiRow =>
                row !== null &&
                typeof row === "object" &&
                "item" in row &&
                typeof (row as AiRow).item === "string",
            )
          : [];
        logPipeline(`Parsed ${String(nextRows.length)} row(s) from API.`);
        const newItems = rowsToItems(nextRows);
        setLastAdded(nextRows.length > 0 ? nextRows : null);
        if (newItems.length > 0) {
          logPipeline(`Merging ${String(newItems.length)} item(s) into list…`);
          updateList([...items, ...newItems]);
          logPipeline("List saved (local + sync when online).");
        } else {
          logPipeline("No items to save.");
        }
        setStatus(
          newItems.length > 0
            ? isOnline
              ? "Saved and synced."
              : "Saved locally. Will sync when online."
            : "No items found.",
        );
        return newItems.length > 0;
      } catch {
        logPipeline("Request threw (network or parse error).");
        setLastAdded(null);
        setStatus("Error parsing list.");
        return false;
      }
    },
    [isOnline, items, logPipeline, updateList],
  );

  const stopRecording = useCallback(() => {
    holdingRef.current = false;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!isOnline) {
      setStatus("Voice input requires an internet connection.");
      return;
    }

    holdingRef.current = true;
    logPipeline("Microphone: requesting access…");
    setStatus("Requesting microphone…");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!holdingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        logPipeline("Microphone: released before recording started.");
        setStatus("");
        return;
      }
      logPipeline("Microphone: recording…");
      streamRef.current = stream;
      hasSpokenRef.current = false;
      setIsRecording(true);

      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioContextCtor();
      const analyser = audioContextRef.current.createAnalyser();
      audioContextRef.current.createMediaStreamSource(stream).connect(analyser);
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkAudioLevel = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = dataArray[i] / 128.0 - 1.0;
          sumSquares += norm * norm;
        }
        if (Math.sqrt(sumSquares / dataArray.length) > 0.05) {
          hasSpokenRef.current = true;
        }
        if (!hasSpokenRef.current && stream.active) {
          animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
        }
      };
      checkAudioLevel();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        const chunks = audioChunksRef.current;
        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        audioChunksRef.current = [];

        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
          void audioContextRef.current.close();
          audioContextRef.current = null;
        }

        if (!hasSpokenRef.current) {
          logPipeline("Stopped: no speech detected.");
          setStatus("Didn't hear anything. Try again!");
          return;
        }

        logPipeline("Recording stopped; converting to base64…");
        setStatus("Sending to Gemini…");

        try {
          const audioData = await blobToBase64(audioBlob);
          logPipeline(`Audio ready (${String(Math.round(audioData.length / 1024))} KB base64).`);
          await submitToGemini({
            audioData,
            mimeType: audioBlob.type ?? "audio/webm",
          });
        } catch {
          logPipeline("Failed to encode or send audio.");
          setStatus("Failed to send audio. Try again.");
        }
      };

      mediaRecorder.start();
      setStatus("Listening…");
    } catch {
      setIsRecording(false);
      logPipeline("Microphone: denied or unavailable.");
      setStatus("Microphone access denied or unavailable.");
    }
  }, [isOnline, logPipeline, submitToGemini]);

  const handleTypedSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isOnline) return;
    const trimmed = listText.trim();
    if (trimmed.length === 0) {
      setStatus("Type a list first.");
      return;
    }
    void (async () => {
      logPipeline("Typed submit: sending to Gemini.");
      const ok = await submitToGemini({ text: trimmed });
      if (ok) setListText("");
    })();
  };

  const offlineHint = !isOnline
    ? "Reconnect to add items with AI."
    : "mleko, chleb, pomidory…";

  return (
    <main className="page">
      <form className="page__form" onSubmit={handleTypedSubmit}>
        <label className="page__label" htmlFor="grocery-text">
          Type your list
        </label>
        <textarea
          id="grocery-text"
          className="page__textarea"
          rows={4}
          value={listText}
          onChange={(e) => setListText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) {
              return;
            }
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
          placeholder={offlineHint}
          disabled={!isOnline}
        />
        <button type="submit" className="page__submit" disabled={!isOnline}>
          Send to list
        </button>
      </form>

      <p className="page__divider">or hold to speak</p>

      <button
        type="button"
        className={`page__record${isRecording ? " page__record--active" : ""}`}
        onPointerDown={(e) => {
          e.preventDefault();
          void startRecording();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          stopRecording();
        }}
        onPointerLeave={() => {
          stopRecording();
        }}
        disabled={!isOnline}
      >
        {isRecording ? "Listening…" : "Hold to Speak"}
      </button>

      {status ? (
        <p className="page__status">{status}</p>
      ) : (
        <p className="page__status page__status--muted">
          {isOnline ? "Ready" : "Voice and AI require a connection."}
        </p>
      )}

      <details className="debug-log">
        <summary className="debug-log__summary">Pipeline log</summary>
        <div className="debug-log__toolbar">
          <button
            type="button"
            className="debug-log__clear"
            onClick={() => setPipelineLog([])}
          >
            Clear log
          </button>
        </div>
        <pre className="debug-log__pre">
          {pipelineLog.length === 0 ? (
            "No events yet — hold to speak or use typed list."
          ) : (
            pipelineLog.join("\n")
          )}
        </pre>
      </details>

      {lastAdded ? (
        <ul className="page__preview">
          {lastAdded.map((row, i) => (
            <li key={`${row.item}-${i}`} className="page__preview-row">
              <span className="page__preview-name">{row.item}</span>
              {row.category ? (
                <span className="page__preview-cat"> — {row.category}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
