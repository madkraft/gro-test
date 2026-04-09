import { useCallback, useRef, useState, type FormEvent } from "react";
import "./App.css";

const PROCESS_AUDIO_PATH = "/.netlify/functions/process-audio";

type GroceryItem = { item: string; category?: string };

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

export default function App() {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  const [listText, setListText] = useState("");
  const holdingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const hasSpokenRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const submitPayload = useCallback(
    async (payload: { audioData?: string; text?: string }) => {
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
          setItems(null);
          setStatus(payloadJson.error ?? "Error saving list.");
          return;
        }
        const raw = payloadJson.items;
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
    },
    [],
  );

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
  }, [submitPayload]);

  const handleTypedSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = listText.trim();
    if (trimmed.length === 0) {
      setStatus("Type a list first.");
      return;
    }
    void (async () => {
      await submitPayload({ text: trimmed });
      setListText("");
    })();
  };

  return (
    <main className="app">
      <h1 className="app__title">Say or type what we need to buy 🛒</h1>

      <form className="app__form" onSubmit={handleTypedSubmit}>
        <label className="app__label" htmlFor="grocery-text">
          Or type your list
        </label>
        <textarea
          id="grocery-text"
          className="app__textarea"
          rows={4}
          value={listText}
          onChange={(e) => setListText(e.target.value)}
          placeholder="mleko, chleb, pomidory…"
        />
        <button type="submit" className="app__submit">
          Send to list
        </button>
      </form>

      <p className="app__divider">or hold to speak</p>

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
      {status ? (
        <p className="app__status">{status}</p>
      ) : (
        <p className="app__status">Ready to listen</p>
      )}
      {items ? (
        <ul className="app__items">
          {items.map((row, i) => (
            <li key={`${row.item}-${i}`} className="app__item">
              <span className="app__item-name">{row.item}</span>
              {row.category ? (
                <span className="app__item-category"> — {row.category}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
