import { genai } from "../clients/genaiClient";
import { withRetry } from "../utils/retry";
import { metrics } from "./metrics";

// ─── STT: transcribe via Gemini generateContent ───────────────────────────────
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  metrics.totalSTTCalls++;
  console.log(`\n🎤 STT call #${metrics.totalSTTCalls}`);

  const base64Audio = audioBuffer.toString("base64");

  const sttResponse = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Transcribe this audio exactly. Return only the transcript, no commentary.",
            },
            { inlineData: { mimeType: "audio/webm", data: base64Audio } },
          ],
        },
      ],
    })
  );

  return sttResponse.text?.trim() ?? "";
}
