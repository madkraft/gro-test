import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, type SubmitEvent } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { useWhisper } from "../hooks/useWhisper";
import { WHISPER_MODEL_ID } from "../lib/whisper-config";
import type { GroceryItem } from "../types/grocery";

const PROCESS_AUDIO_PATH = "/.netlify/functions/process-audio";
const TARGET_SAMPLE_RATE = 16_000;

type AiRow = { item: string; category?: string };

/**
 * Decode a Blob of audio and resample it to a mono Float32Array at 16 kHz,
 * which is the format Whisper expects.
 */
async function resampleAudio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  void decodeCtx.close();

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

/**
 * Fallback: if we're offline after transcribing, split the raw text into
 * items and add them all under "❓ Inne" without going through Gemini.
 */
function parseOfflineTranscript(transcript: string): AiRow[] {
  return transcript
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((item) => ({ item }));
}

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

  const whisper = useWhisper({ onLog: logPipeline });

  const [status, setStatus] = useState("");
  const [lastAdded, setLastAdded] = useState<AiRow[] | null>(null);
  const [listText, setListText] = useState("");

  const holdingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const hasSpokenRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  /** Send a text string to the Gemini Netlify function for categorisation. */
  const submitText = useCallback(
    async (text: string): Promise<boolean> => {
      logPipeline("Sending text to Gemini (process-audio)…");
      setStatus("Processing list…");
      try {
        const response = await fetch(PROCESS_AUDIO_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        logPipeline(`process-audio responded HTTP ${String(response.status)}.`);
        const payloadJson = (await response.json()) as {
          success?: boolean;
          error?: string;
          items?: unknown;
        };
        if (!response.ok || payloadJson.success === false) {
          logPipeline(
            `Gemini step failed: ${payloadJson.error ?? "unknown error"}.`,
          );
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
        logPipeline("process-audio request threw (network or parse error).");
        setLastAdded(null);
        setStatus("Error parsing list.");
        return false;
      }
    },
    [isOnline, items, logPipeline, updateList],
  );

  /** Offline fallback after transcription: save without AI categorisation. */
  const saveOffline = useCallback(
    (rows: AiRow[]) => {
      logPipeline("Offline: skipping Gemini, saving raw split lines.");
      const newItems = rowsToItems(rows);
      if (newItems.length > 0) {
        logPipeline(`Saving ${String(newItems.length)} item(s) under ❓ Inne.`);
        updateList([...items, ...newItems]);
        setLastAdded(rows);
        setStatus("Saved locally without categories. Will sync when online.");
      } else {
        logPipeline("Nothing to save after offline split.");
        setLastAdded(null);
        setStatus("Nothing recognised.");
      }
    },
    [items, logPipeline, updateList],
  );

  const stopRecording = useCallback(() => {
    holdingRef.current = false;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (whisper.state !== "ready") return;

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

        logPipeline("Recording stopped; resampling to 16 kHz mono…");
        // Step 1: transcribe locally (works offline after model is cached)
        setStatus("Transcribing…");
        let transcript: string;
        try {
          const audio = await resampleAudio(audioBlob);
          logPipeline(`Audio buffer ready (${String(audio.length)} samples).`);
          transcript = await whisper.transcribe(audio);
          const preview =
            transcript.length > 100
              ? `${transcript.slice(0, 100)}…`
              : transcript;
          logPipeline(`Transcript: ${preview}`);
        } catch {
          logPipeline("Transcription error (worker or resampling).");
          setStatus("Transcription failed. Try again.");
          return;
        }

        if (!transcript.trim()) {
          logPipeline("Transcript empty after Whisper.");
          setStatus("Couldn't make out any words. Try again.");
          return;
        }

        // Step 2: categorise via Gemini (needs internet)
        if (!isOnline) {
          logPipeline("Device offline → offline parse + local save.");
          saveOffline(parseOfflineTranscript(transcript));
          return;
        }
        logPipeline("Online → sending transcript to Gemini.");
        await submitText(transcript);
      };

      mediaRecorder.start();
      setStatus("Listening…");
    } catch {
      logPipeline("Microphone: denied or unavailable.");
      setStatus("Microphone access denied or unavailable.");
    }
  }, [whisper, isOnline, logPipeline, submitText, saveOffline]);

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
      const ok = await submitText(trimmed);
      if (ok) setListText("");
    })();
  };

  const modelLoading = whisper.state === "loading";
  const modelError = whisper.state === "error";
  const showPanel = modelLoading || modelError;

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
          placeholder={offlineHint}
          disabled={!isOnline}
        />
        <button type="submit" className="page__submit" disabled={!isOnline}>
          Send to list
        </button>
      </form>

      <p className="page__divider">or hold to speak</p>

      {showPanel ? (
        <div
          className={
            modelError
              ? "model-loader model-loader--error"
              : "model-loader"
          }
          role="status"
          aria-live="polite"
        >
          {modelError ? (
            <>
              <p className="model-loader__title">Voice model failed to load</p>
              <p className="model-loader__error">{whisper.errorMessage}</p>
              <button
                type="button"
                className="model-loader__retry"
                onClick={whisper.retry}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="model-loader__title">Downloading voice model</p>
              <p className="model-loader__body">
                Loading a tiny AI speech model (~45 MB) directly into your
                browser. Once cached, voice recognition works offline — no
                server involved.
              </p>
              <div className="model-loader__track">
                <div
                  className="model-loader__bar"
                  style={{ width: `${whisper.loadProgress}%` }}
                />
              </div>
              <p className="model-loader__note">
                One-time download · {Math.round(whisper.loadProgress)}% complete
              </p>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="page__record"
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
        >
          Hold to Speak
        </button>
      )}

      {status ? (
        <p className="page__status">{status}</p>
      ) : (
        <p className="page__status page__status--muted">
          {modelLoading
            ? "Voice will be ready when the download finishes."
            : isOnline
              ? "Ready"
              : "Voice works offline; categories need connection."}
        </p>
      )}

      <p className="page__model" aria-label="Active Whisper model">
        Voice:{" "}
        {whisper.modelInfo ? (
          <>
            {whisper.modelInfo.modelId} · {whisper.modelInfo.dtype} ·{" "}
            {whisper.modelInfo.language}
          </>
        ) : whisper.state === "loading" ? (
          <>
            {WHISPER_MODEL_ID}
            <span className="page__model-note"> (loading…)</span>
          </>
        ) : whisper.state === "error" ? (
          <>
            {WHISPER_MODEL_ID}
            <span className="page__model-note"> (error)</span>
          </>
        ) : (
          WHISPER_MODEL_ID
        )}
      </p>

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
