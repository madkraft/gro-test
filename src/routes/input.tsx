import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, type SubmitEvent } from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { useWhisper } from "../hooks/useWhisper";
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
  const whisper = useWhisper();

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
      setStatus("Processing list…");
      try {
        const response = await fetch(PROCESS_AUDIO_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const payloadJson = (await response.json()) as {
          success?: boolean;
          error?: string;
          items?: unknown;
        };
        if (!response.ok || payloadJson.success === false) {
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
        const newItems = rowsToItems(nextRows);
        setLastAdded(nextRows.length > 0 ? nextRows : null);
        if (newItems.length > 0) {
          updateList([...items, ...newItems]);
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
        setLastAdded(null);
        setStatus("Error parsing list.");
        return false;
      }
    },
    [isOnline, items, updateList],
  );

  /** Offline fallback after transcription: save without AI categorisation. */
  const saveOffline = useCallback(
    (rows: AiRow[]) => {
      const newItems = rowsToItems(rows);
      if (newItems.length > 0) {
        updateList([...items, ...newItems]);
        setLastAdded(rows);
        setStatus("Saved locally without categories. Will sync when online.");
      } else {
        setLastAdded(null);
        setStatus("Nothing recognised.");
      }
    },
    [items, updateList],
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
    setStatus("Requesting microphone…");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!holdingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setStatus("");
        return;
      }
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
          setStatus("Didn't hear anything. Try again!");
          return;
        }

        // Step 1: transcribe locally (works offline after model is cached)
        setStatus("Transcribing…");
        let transcript: string;
        try {
          const audio = await resampleAudio(audioBlob);
          transcript = await whisper.transcribe(audio);
        } catch {
          setStatus("Transcription failed. Try again.");
          return;
        }

        if (!transcript.trim()) {
          setStatus("Couldn't make out any words. Try again.");
          return;
        }

        // Step 2: categorise via Gemini (needs internet)
        if (!isOnline) {
          saveOffline(parseOfflineTranscript(transcript));
          return;
        }
        await submitText(transcript);
      };

      mediaRecorder.start();
      setStatus("Listening…");
    } catch {
      setStatus("Microphone access denied or unavailable.");
    }
  }, [whisper, isOnline, submitText, saveOffline]);

  const handleTypedSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isOnline) return;
    const trimmed = listText.trim();
    if (trimmed.length === 0) {
      setStatus("Type a list first.");
      return;
    }
    void (async () => {
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
