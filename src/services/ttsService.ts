import { WebSocket } from "ws";
import { genai } from "../clients/genaiClient";
import { withRetry } from "../utils/retry";
import { pcmToWav } from "../utils/pcmToWav";
import { metrics } from "./metrics";

// ─── TTS Helper ───────────────────────────────────────────────────────────────
// ✅ FIX: signature is (text, ws) — was incorrectly called with session in old code
export async function speakText(text: string, ws: WebSocket) {
  try {
    metrics.totalTTSCalls++;
    console.log(`\n🔊 TTS call #${metrics.totalTTSCalls}`);

    const ttsResponse = await withRetry(() =>
      genai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      })
    );

    const pcmBase64 =
      ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!pcmBase64) {
      ws.send(JSON.stringify({ type: "error", message: "TTS returned no audio" }));
      return;
    }

    const wavBuffer = pcmToWav(Buffer.from(pcmBase64, "base64"), 24000, 1, 16);

    ws.send(JSON.stringify({ type: "audio_start" }));
    ws.send(wavBuffer);
    ws.send(JSON.stringify({ type: "audio_end" }));
  } catch (err) {
    console.error("TTS error:", err);
    ws.send(JSON.stringify({ type: "error", message: "TTS failed" }));
  }
}
