import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useRef,
  useState,
  type SubmitEvent,
} from "react";
import { useGroceryList } from "../hooks/useGroceryList";
import { getItems } from "../lib/storage";
import type { GroceryItem } from "../types/grocery";

const PROCESS_AUDIO_PATH = "/.netlify/functions/process-audio";

type AiRow = { item: string; category?: string };

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result"));
        return;
      }
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve(base64);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
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
  const { updateList, isOnline, isSyncing } = useGroceryList();
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

  const submitPayload = useCallback(
    async (payload: { audioData?: string; text?: string }): Promise<boolean> => {
      setStatus("Processing list…");
      try {
        const response = await fetch(PROCESS_AUDIO_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
          updateList([...getItems(), ...newItems]);
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
    [isOnline, updateList],
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
      return;
    }
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

        const audioData = await blobToBase64(audioBlob);
        await submitPayload({ audioData });
      };

      mediaRecorder.start();
      setStatus("Listening…");
    } catch {
      setStatus("Microphone access denied or unavailable.");
    }
  }, [isOnline, submitPayload]);

  const handleTypedSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isOnline) {
      return;
    }
    const trimmed = listText.trim();
    if (trimmed.length === 0) {
      setStatus("Type a list first.");
      return;
    }
    void (async () => {
      const ok = await submitPayload({ text: trimmed });
      if (ok) {
        setListText("");
      }
    })();
  };

  const offlineHint = !isOnline
    ? "Reconnect to add items with AI."
    : "mleko, chleb, pomidory…";

  return (
    <main className="page page--input">
      <h1 className="page__title">Say or type what we need to buy</h1>
      {isSyncing ? (
        <p className="page__hint">Syncing list…</p>
      ) : null}

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

      <button
        type="button"
        className={
          isOnline ? "page__record" : "page__record page__record--disabled"
        }
        disabled={!isOnline}
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
        {isOnline ? "Hold to Speak" : "AI unavailable offline"}
      </button>
      {status ? (
        <p className="page__status">{status}</p>
      ) : (
        <p className="page__status page__status--muted">
          {isOnline ? "Ready" : "List works offline; AI needs connection."}
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
