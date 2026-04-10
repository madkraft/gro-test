/// <reference lib="webworker" />
import { env, pipeline } from "@huggingface/transformers";

// Always fetch from the Hugging Face Hub (cached by the browser after first load)
env.allowLocalModels = false;

const MODEL_ID = "onnx-community/whisper-tiny";

type IncomingMessage =
  | { type: "load" }
  | { type: "transcribe"; audio: Float32Array };

type OutgoingMessage =
  | { type: "loading"; progress: number; text: string }
  | { type: "ready" }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

function send(msg: OutgoingMessage) {
  self.postMessage(msg);
}

type ProgressInfo = {
  status?: string;
  progress?: number;
  file?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

async function loadModel() {
  transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "q4",
    progress_callback: (info: unknown) => {
      const p = info as ProgressInfo;
      if (p.status === "progress" || p.status === "downloading") {
        const pct = Math.round(p.progress ?? 0);
        send({
          type: "loading",
          progress: pct,
          text: `Downloading model… ${pct}%`,
        });
      } else if (p.status === "initiate") {
        send({ type: "loading", progress: 0, text: "Preparing model…" });
      } else if (p.status === "done") {
        send({ type: "loading", progress: 100, text: "Model loaded." });
      }
    },
  });
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  if (msg.type === "load") {
    try {
      send({ type: "loading", progress: 0, text: "Starting model load…" });
      await loadModel();
      send({ type: "ready" });
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load model",
      });
    }
    return;
  }

  if (msg.type === "transcribe") {
    if (!transcriber) {
      send({ type: "error", message: "Model not ready" });
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = (await transcriber(msg.audio, {
        task: "transcribe",
        language: "polish",
        return_timestamps: true,
        chunk_length_s: 30,
      })) as { text?: string } | { text?: string }[];
      const text = Array.isArray(result)
        ? (result[0]?.text ?? "")
        : (result?.text ?? "");
      send({ type: "result", text: text.trim() });
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : "Transcription failed",
      });
    }
  }
};
