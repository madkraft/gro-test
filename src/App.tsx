import { useCallback, useRef, useState } from "react";
import "./App.css";

const PROCESS_AUDIO_PATH = "/.netlify/functions/process-audio";

type GroceryItem = { item: string; quantity?: string | number };

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
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  const holdingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    holdingRef.current = false;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
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
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setStatus("Processing list…");
        const chunks = audioChunksRef.current;
        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        audioChunksRef.current = [];

        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        try {
          const audioData = await blobToBase64(audioBlob);
          const response = await fetch(PROCESS_AUDIO_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioData }),
          });
          const payload = (await response.json()) as {
            success?: boolean;
            error?: string;
            items?: unknown;
          };
          if (!response.ok || payload.success === false) {
            setItems(null);
            setStatus(payload.error ?? "Error saving list.");
            return;
          }
          const raw = payload.items;
          const nextItems = Array.isArray(raw)
            ? raw.filter(
                (row): row is GroceryItem =>
                  row !== null &&
                  typeof row === "object" &&
                  "item" in row &&
                  typeof (row as GroceryItem).item === "string",
              )
            : [];
          setItems(nextItems.length > 0 ? nextItems : null);
          setStatus("Added to Notion!");
        } catch {
          setItems(null);
          setStatus("Error saving list.");
        }
      };

      mediaRecorder.start();
      setStatus("Listening…");
    } catch {
      setStatus("Microphone access denied or unavailable.");
    }
  }, []);

  return (
    <main className="app">
      <h1 className="app__title">Say what we need to buy 🛒</h1>
      <button
        type="button"
        className="app__record"
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
      {status ? <p className="app__status">{status}</p> : null}
      {items ? (
        <ul className="app__items">
          {items.map((row, i) => (
            <li key={`${row.item}-${i}`} className="app__item">
              <span className="app__item-name">{row.item}</span>
              {row.quantity !== undefined ? (
                <span className="app__item-qty"> × {String(row.quantity)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
