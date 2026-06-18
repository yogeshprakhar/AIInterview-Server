// import express from "express";
// import multer from "multer";
// import cors from "cors";
// import { WebSocketServer, WebSocket } from "ws";
// import { createServer } from "http";
// import { PDFParse } from "pdf-parse";
// import * as dotenv from "dotenv";
// dotenv.config();

// // ─── LangChain — chat model (Gemini) ─────────────────────────────────────────
// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import {
//   HumanMessage,
//   AIMessage,
//   SystemMessage,
//   BaseMessage,
// } from "@langchain/core/messages";
// import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
// import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
// import { LLMResult } from "@langchain/core/outputs";

// // ─── Google GenAI SDK — STT + TTS (not wrapped by LangChain) ─────────────────
// import { GoogleGenAI } from "@google/genai";
// import { Serialized } from "@langchain/core/load/serializable";

// const app = express();
// const server = createServer(app);
// const wss = new WebSocketServer({ server });
// const upload = multer({ storage: multer.memoryStorage() });

// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;

// // ─── Metrics ──────────────────────────────────────────────────────────────────
// const metrics = {
//   totalLLMCalls: 0,
//   totalSTTCalls: 0,
//   totalTTSCalls: 0,
//   totalPromptTokens: 0,
//   totalCompletionTokens: 0,

//   log() {
//     console.log("\n📊 ===== METRICS =====");
//     console.log(`LLM calls  : ${this.totalLLMCalls}`);
//     console.log(`STT calls  : ${this.totalSTTCalls}`);
//     console.log(`TTS calls  : ${this.totalTTSCalls}`);
//     console.log(`Total API  : ${this.totalLLMCalls + this.totalSTTCalls + this.totalTTSCalls}`);
//     console.log(`Prompt tokens     : ${this.totalPromptTokens}`);
//     console.log(`Completion tokens : ${this.totalCompletionTokens}`);
//     console.log("=====================\n");
//   },
// };

// // ─── Callback Handler — logs every LLM call ───────────────────────────────────
// class InterviewCallbackHandler extends BaseCallbackHandler {
//   name = "InterviewCallbackHandler";

//   async handleChatModelStart(
//     // llm: { name: string },
//     llm: Serialized,
//     messages: BaseMessage[][],
//     runId: string
//   ) {
//     console.log("\n========== LLM CALL START ==========");
//     console.log(`Model   : ${llm.name}`);
//     console.log(`Run ID  : ${runId}`);
//     console.log(`Messages in prompt: ${messages[0].length}`);
//     messages[0].forEach((msg, i) => {
//       const content =
//         typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
//       console.log(
//         `  [${i}] ${msg._getType().toUpperCase()}: ${content.slice(0, 120)}${content.length > 120 ? "…" : ""}`
//       );
//     });
//     console.log("=====================================\n");
//   }

//   async handleLLMEnd(output: LLMResult, runId: string) {
//     console.log("\n========== LLM CALL END ==========");
//     console.log(`Run ID  : ${runId}`);
//     const text = output.generations[0][0].text;
//     console.log(`Response: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
//     if (output.llmOutput?.tokenUsage) {
//       const { promptTokens, completionTokens, totalTokens } =
//         output.llmOutput.tokenUsage;
//       console.log(
//         `Tokens — prompt: ${promptTokens}, completion: ${completionTokens}, total: ${totalTokens}`
//       );
//       metrics.totalPromptTokens += promptTokens ?? 0;
//       metrics.totalCompletionTokens += completionTokens ?? 0;
//     }
//     console.log("==================================\n");
//   }


//   async handleLLMError(error: Error, runId: string) {
//     console.error(`\n❌ LLM ERROR [${runId}]:`, error.message);
//   }
// }

// const callbackHandler = new InterviewCallbackHandler();

// // ─── LangChain chat model ─────────────────────────────────────────────────────
// const chatModel = new ChatGoogleGenerativeAI({
//   model: "gemini-2.5-flash-lite",
//   apiKey: GOOGLE_API_KEY,
//   temperature: 0.7,
//   maxRetries: 3,
//   callbacks: [callbackHandler], // ← attach callback handler
// });

// // ─── Native Google GenAI client — STT + TTS ───────────────────────────────────
// const genai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// // ─── Retry wrapper for native genai calls (handles 503) ───────────────────────
// async function withRetry<T>(
//   fn: () => Promise<T>,
//   retries = 3,
//   delayMs = 2000
// ): Promise<T> {
//   for (let i = 0; i < retries; i++) {
//     try {
//       return await fn();
//     } catch (err: any) {
//       if (err?.status === 503 && i < retries - 1) {
//         console.log(`⚠️  503 received, retrying in ${delayMs}ms… (attempt ${i + 1})`);
//         await new Promise((res) => setTimeout(res, delayMs));
//       } else {
//         throw err;
//       }
//     }
//   }
//   throw new Error("Max retries exceeded");
// }

// // ─── Types ────────────────────────────────────────────────────────────────────
// interface AnswerRating {
//   score: number;
//   isDetailed: boolean;
// }

// interface TurnOptions {
//   silenceSkip?: boolean;
// }

// // ─── Session Store ────────────────────────────────────────────────────────────
// interface Session {
//   history: InMemoryChatMessageHistory;
//   systemPrompt: string;
//   ws?: WebSocket;
//   questionCount: number;
//   maxQuestions: number;
//   interviewEnded: boolean;
//   lastAnswerRating?: AnswerRating;
//   answerRatings: { question: number; score: number }[];
//   lastActivityAt: number;
//   silenceTimer?: ReturnType<typeof setTimeout>;
//   hasNudged: boolean;
//   skippedCount: number;
// }

// const sessions = new Map<string, Session>();

// app.use(cors());
// app.use(express.json());

// // ─── 1. REST — Upload Resume & Create Session ─────────────────────────────────
// app.post("/start-interview", upload.single("resume"), async (req, res) => {
//   try {
//     const parser = new PDFParse({ data: req.file!.buffer });
//     const pdf = await parser.getText();
//     console.log(pdf.text);
//     await parser.destroy();

//     const systemPrompt = `You are a strict but fair technical interviewer conducting a structured interview.

// RESPONSE FORMAT — you MUST always reply with this exact JSON structure (no markdown, no extra keys):
// {
//   "reply": "<your spoken response — max 3 sentences>",
//   "answerScore": <integer 0-10 rating of the candidate's last answer, or null on the opening greeting>,
//   "nextStrategy": "deeper" | "new_topic" | "opening"
// }

// RULES:
// 1. Ask exactly ONE question per turn. Never ask two questions at once.
// 2. You will ask a TOTAL of 10 questions. No more.
// 3. Acknowledge the candidate's answer naturally in "reply" before asking the next question.
// 4. Decide "nextStrategy" based on "answerScore":
//    - Score >= 8  → "deeper"    (follow up on the same topic or something they mentioned)
//    - Score < 8   → "new_topic" (switch to a different topic from the resume)
//    - Opening     → "opening"   (no answer yet)
// 5. After the 10th answer, do NOT ask another question — give a brief closing statement.

// RESUME:
// ${pdf.text}`;

//     const sessionId = crypto.randomUUID();
//     sessions.set(sessionId, {
//       history: new InMemoryChatMessageHistory(),
//       systemPrompt,
//       questionCount: 0,
//       maxQuestions: 10,
//       interviewEnded: false,
//       answerRatings: [],
//       lastActivityAt: Date.now(),
//       hasNudged: false,
//       skippedCount: 0,
//     });

//     res.json({ sessionId });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to process resume" });
//   }
// });

// // ─── 2. REST — Stop Interview Early ──────────────────────────────────────────
// app.post("/stop-interview", async (req, res) => {
//   const { sessionId } = req.body as { sessionId?: string };

//   if (!sessionId || !sessions.has(sessionId)) {
//     return res.status(404).json({ error: "Session not found" });
//   }

//   const session = sessions.get(sessionId)!;

//   if (session.interviewEnded) {
//     return res.status(400).json({ error: "Interview already ended" });
//   }

//   // cancel any pending silence timer
//   clearTimeout(session.silenceTimer);

//   session.interviewEnded = true;
//   res.json({ message: "Interview stop request received. Generating results…" });

//   finaliseInterview(session, true).catch(console.error);
// });

// // ─── 3. WebSocket — Realtime Interview ───────────────────────────────────────
// wss.on("connection", (ws, req) => {
//   console.log("WS connection received");
//   const sessionId = req.url?.split("/interview/")[1];

//   if (!sessionId || !sessions.has(sessionId)) {
//     ws.send(JSON.stringify({ type: "error", message: "Invalid session" }));
//     ws.close();
//     return;
//   }

//   const session = sessions.get(sessionId)!;
//   session.ws = ws;
//   console.log(`WS connected: ${sessionId}`);

//   // Kick off the interview — AI greets and asks first question
//   triggerAITurn(session);

//   ws.on("message", async (data: Buffer) => {
//     try {
//       // ── Check if this is a JSON signal (not audio binary) ────────────────
//       // try {
//       //   const signal = JSON.parse(data.toString());
//       //   // if (signal.type === "silence_timeout") {
//       //   //   await handleSilenceTimeout(session);
//       //   //   return;
//       //   // }
//       // } catch {
//       //   // not JSON — it's audio binary, fall through
//       // }

//       // ── Cancel silence watchdog — user is responding ─────────────────────
//       clearTimeout(session.silenceTimer);           // ✅ FIX: was missing
//       session.lastActivityAt = Date.now();
//       session.hasNudged = false;                    // ✅ FIX: reset nudge state

//       // ── STT: transcribe via Gemini generateContent ───────────────────────
//       metrics.totalSTTCalls++;
//       console.log(`\n🎤 STT call #${metrics.totalSTTCalls}`);

//       const base64Audio = data.toString("base64");

//       const sttResponse = await withRetry(() =>
//         genai.models.generateContent({
//           model: "gemini-2.5-flash",
//           contents: [
//             {
//               role: "user",
//               parts: [
//                 {
//                   text: "Transcribe this audio exactly. Return only the transcript, no commentary.",
//                 },
//                 { inlineData: { mimeType: "audio/webm", data: base64Audio } },
//               ],
//             },
//           ],
//         })
//       );

//       const userText = sttResponse.text?.trim() ?? "";
//       ws.send(JSON.stringify({ type: "transcript", role: "user", text: userText }));

//       await session.history.addMessage(new HumanMessage(userText));
//       await triggerAITurn(session);
//     } catch (err: any) {
//       console.error(err);
//       if (err?.status === 503) {
//         ws.send(
//           JSON.stringify({
//             type: "error",
//             message: "AI is busy right now — please try again in a moment.",
//           })
//         );
//       } else {
//         ws.send(JSON.stringify({ type: "error", message: "Failed to process audio" }));
//       }
//     }
//   });

//   ws.on("close", () => {
//     console.log(`WS disconnected: ${sessionId}`);
//     clearTimeout(session.silenceTimer); // clean up timer on disconnect
//     console.log("\n🏁 Session ended — final metrics:");
//     metrics.log();
//     sessions.delete(sessionId);
//   });
// });

// // ─── AI Turn: LangChain LLM → Gemini TTS → send audio back ───────────────────
// async function triggerAITurn(session: Session, options: TurnOptions = {}) {
//   console.log("Triggering AI turn");
//   const ws = session.ws!;

//   if (session.interviewEnded) return;

//   const isOpening = session.questionCount === 0;
//   const reachedLimit = session.questionCount >= session.maxQuestions;

//   const statusNote = reachedLimit
//     ? `Do NOT ask any more questions. Close the interview now.`
//     : `You have asked ${session.questionCount} out of ${session.maxQuestions} questions. You may ask ${session.maxQuestions - session.questionCount} more.`;

//   // ✅ FIX: skipInstruction is now actually included in the prompt
// //   const skipInstruction = options.silenceSkip
// //     ? `\n\nIMPORTANT: The candidate just stayed silent and did not answer twice.
// // First acknowledge this warmly and empathetically in 1 sentence
// // (e.g. "That's okay, some concepts can be tricky — let's move on."
// // or "No worries at all, let's try a different angle.").
// // DO NOT repeat the previous question.
// // Then immediately ask your next interview question.
// // Keep the entire response under 3 sentences.`
// //     : "";

//   // ✅ combinedSystemPrompt
//   const combinedSystemPrompt = `${session.systemPrompt}\n\nCURRENT STATUS: ${statusNote}`;

//   const pastMessages = await session.history.getMessages();

//   const contentMessages: BaseMessage[] = isOpening
//     ? [new HumanMessage("Begin the interview. Greet the candidate and ask your first question.")]
//     : pastMessages;

//   const messages: BaseMessage[] = [
//     new SystemMessage(combinedSystemPrompt),
//     ...contentMessages,
//   ];

//   // ── LLM call ──────────────────────────────────────────────────────────────
//   metrics.totalLLMCalls++;
//   console.log(
//     `\n🤖 LLM call #${metrics.totalLLMCalls} | questionCount: ${session.questionCount}`
//   );

//   const aiResponse = await chatModel.invoke(messages);

//   // capture token usage if returned
//   if ((aiResponse as any).response_metadata?.tokenUsage) {
//     const { promptTokens, completionTokens } =
//       (aiResponse as any).response_metadata.tokenUsage;
//     metrics.totalPromptTokens += promptTokens ?? 0;
//     metrics.totalCompletionTokens += completionTokens ?? 0;
//   }

//   const raw =
//     typeof aiResponse.content === "string"
//       ? aiResponse.content
//       : aiResponse.content
//           .filter((c) => c.type === "text")
//           .map((c) => (c as { type: "text"; text: string }).text)
//           .join("");

//   // ── Parse JSON response ────────────────────────────────────────────────────
//   let replyText = raw;
//   let answerScore: number | null = null;
//   let nextStrategy: "deeper" | "new_topic" | "opening" = "new_topic";

//   try {
//     const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
//       reply: string;
//       answerScore: number | null;
//       nextStrategy: "deeper" | "new_topic" | "opening";
//     };
//     replyText = parsed.reply;
//     answerScore = parsed.answerScore;
//     nextStrategy = parsed.nextStrategy;
//   } catch {
//     console.warn("AI response was not valid JSON, using raw text as reply.");
//   }

//   // Store rating for scorecard
//   if (answerScore !== null && !isOpening) {
//     session.answerRatings.push({ question: session.questionCount, score: answerScore });
//   }

//   if (answerScore !== null) {
//     session.lastAnswerRating = {
//       score: answerScore,
//       isDetailed: answerScore >= 8,
//     };
//   }

//   await session.history.addMessage(new AIMessage(replyText));

//   if (reachedLimit) {
//     // Natural end after Q10
//     await finaliseInterview(session, false);
//     return;
//   }

//   session.questionCount++;

  
//   // ── TTS ────────────────────────────────────────────────────────────────────
//   await speakText(replyText, ws);
//   ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: replyText }));

//   // ✅ FIX: start silence watchdog AFTER every AI turn
//   // clearTimeout(session.silenceTimer);
//   // session.silenceTimer = setTimeout(async () => {
//   //   await handleSilenceTimeout(session);
//   // }, 20000);

//   metrics.log();
// }

// // ─── Silence Timeout Handler ──────────────────────────────────────────────────
// // async function handleSilenceTimeout(session: Session) {
// //   const ws = session.ws!;
// //   if (session.interviewEnded) return;

// //   if (!session.hasNudged) {
// //     // ── First timeout → gentle nudge, no LLM call ─────────────────────────
// //     session.hasNudged = true;

// //     const nudgeText = "Take your time — go ahead whenever you're ready.";
// //     ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: nudgeText }));

// //     // ✅ FIX: pass ws not session to speakText
// //     await speakText(nudgeText, ws);

// //     // restart timer for second chance
// //     clearTimeout(session.silenceTimer);
// //     session.silenceTimer = setTimeout(async () => {
// //       await handleSilenceTimeout(session);
// //     }, 20000);
// //   } else {
// //     // ── Second timeout → LLM generates empathetic skip + next question ────
// //     session.hasNudged = false;
// //     session.skippedCount++;

// //     await session.history.addMessage(
// //       new HumanMessage("[The candidate did not respond to this question twice.]")
// //     );

// //     ws.send(JSON.stringify({ type: "transcript", role: "user", text: "(no response)" }));
// //     ws.send(JSON.stringify({ type: "silence_skip" }));

// //     await triggerAITurn(session, { silenceSkip: true });
// //   }
// // }

// // ─── TTS Helper ───────────────────────────────────────────────────────────────
// // ✅ FIX: signature is (text, ws) — was incorrectly called with session in old code
// async function speakText(text: string, ws: WebSocket) {
//   try {
//     metrics.totalTTSCalls++;
//     console.log(`\n🔊 TTS call #${metrics.totalTTSCalls}`);

//     const ttsResponse = await withRetry(() =>
//       genai.models.generateContent({
//         model: "gemini-2.5-flash-preview-tts",
//         contents: [{ role: "user", parts: [{ text }] }],
//         config: {
//           responseModalities: ["AUDIO"],
//           speechConfig: {
//             voiceConfig: {
//               prebuiltVoiceConfig: { voiceName: "Kore" },
//             },
//           },
//         },
//       })
//     );

//     const pcmBase64 =
//       ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

//     if (!pcmBase64) {
//       ws.send(JSON.stringify({ type: "error", message: "TTS returned no audio" }));
//       return;
//     }

//     const wavBuffer = pcmToWav(Buffer.from(pcmBase64, "base64"), 24000, 1, 16);

//     ws.send(JSON.stringify({ type: "audio_start" }));
//     ws.send(wavBuffer);
//     ws.send(JSON.stringify({ type: "audio_end" }));
//   } catch (err) {
//     console.error("TTS error:", err);
//     ws.send(JSON.stringify({ type: "error", message: "TTS failed" }));
//   }
// }

// // ─── Finalise: scorecard + closing message ────────────────────────────────────
// async function finaliseInterview(session: Session, stoppedEarly: boolean) {
//   const ws = session.ws;
//   session.interviewEnded = true;
//   clearTimeout(session.silenceTimer); // cancel any pending timer

//   const allMessages = await session.history.getMessages();

//   // ── Scorecard ──────────────────────────────────────────────────────────────
//   const scorecardResponse = await chatModel.invoke([
//     new SystemMessage(`Based on the interview conversation, generate a JSON scorecard. Return ONLY valid JSON, no markdown:
// {
//   "overallScore": <0-10>,
//   "strengths": ["..."],
//   "weaknesses": ["..."],
//   "topicScores": [{ "topic": "...", "score": <0-10> }],
//   "recommendation": "Strong Hire" | "Hire" | "No Hire",
//   "perAnswerScores": ${JSON.stringify(session.answerRatings)},
//   "skippedQuestions": ${session.skippedCount},
//   "summary": "<2-3 sentence overall assessment>"
// }`),
//     ...allMessages,
//   ]);

//   let scorecard: object = {
//     perAnswerScores: session.answerRatings,
//     skippedQuestions: session.skippedCount,
//   };
//   try {
//     const rawSc =
//       typeof scorecardResponse.content === "string"
//         ? scorecardResponse.content
//         : (scorecardResponse.content as { type: string; text?: string }[])
//             .filter((c) => c.type === "text")
//             .map((c) => c.text ?? "")
//             .join("");
//     scorecard = JSON.parse(rawSc.replace(/```json|```/g, "").trim());
//   } catch (e) {
//     console.error("Scorecard parse error:", e);
//   }

//   // ── Closing spoken message ─────────────────────────────────────────────────
//   const closingPrompt = stoppedEarly
//     ? "The candidate stopped the interview early. Acknowledge warmly, thank them, and say their results are now ready. Under 2 sentences."
//     : "All 10 questions are done. Thank the candidate warmly and let them know their results are ready. Under 2 sentences.";

//   const closingResponse = await chatModel.invoke([
//     new SystemMessage(
//       "You are a professional interviewer. Reply as plain spoken text only — no JSON, no markdown."
//     ),
//     new HumanMessage(closingPrompt),
//   ]);

//   const closingText =
//     typeof closingResponse.content === "string"
//       ? closingResponse.content
//       : (closingResponse.content as { type: string; text?: string }[])
//           .filter((c) => c.type === "text")
//           .map((c) => c.text ?? "")
//           .join("");

//   if (ws && ws.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: closingText }));
//     await speakText(closingText, ws);
//     ws.send(JSON.stringify({ type: "interview_complete", scorecard, stoppedEarly }));
//   }

//   console.log("\n🏁 Interview finalised — final metrics:");
//   metrics.log();
// }

// // ─── Utility: PCM → WAV ───────────────────────────────────────────────────────
// function pcmToWav(
//   pcm: Buffer,
//   sampleRate: number,
//   numChannels: number,
//   bitDepth: number
// ): Buffer {
//   const byteRate = (sampleRate * numChannels * bitDepth) / 8;
//   const blockAlign = (numChannels * bitDepth) / 8;
//   const dataSize = pcm.length;
//   const header = Buffer.alloc(44);

//   header.write("RIFF", 0);
//   header.writeUInt32LE(36 + dataSize, 4);
//   header.write("WAVE", 8);
//   header.write("fmt ", 12);
//   header.writeUInt32LE(16, 16);
//   header.writeUInt16LE(1, 20);
//   header.writeUInt16LE(numChannels, 22);
//   header.writeUInt32LE(sampleRate, 24);
//   header.writeUInt32LE(byteRate, 28);
//   header.writeUInt16LE(blockAlign, 32);
//   header.writeUInt16LE(bitDepth, 34);
//   header.write("data", 36);
//   header.writeUInt32LE(dataSize, 40);

//   return Buffer.concat([header, pcm]);
// }

// server.listen(8000, () => console.log("Server on :8000"));