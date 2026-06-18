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

// // ─── Google GenAI SDK — STT + TTS (not wrapped by LangChain) ─────────────────
// import { GoogleGenAI } from "@google/genai";

// const app = express();
// const server = createServer(app);
// const wss = new WebSocketServer({ server });
// const upload = multer({ storage: multer.memoryStorage() });

// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;

// // LangChain chat model — free tier: gemini-2.5-flash (10 RPM / 250 RPD)
// // Swap to "gemini-2.5-flash-lite" for higher free quota (15 RPM / 1000 RPD)
// const chatModel = new ChatGoogleGenerativeAI({
//   model: "gemini-2.5-flash-lite",
//   apiKey: GOOGLE_API_KEY,
//   temperature: 0.7,
//   maxRetries: 2,
// });

// // Native Google GenAI client — used only for STT and TTS
// // (LangChain does not expose Gemini's audio generation / transcription APIs)
// const genai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// interface AnswerRating {
//   score: number;          // 0–10
//   isDetailed: boolean;    // score >= 8
// }

// interface TurnOptions {
//   silenceSkip?: boolean;
// }

// // ─── Session Store ────────────────────────────────────────────────────────────
// interface Session {
//   history: InMemoryChatMessageHistory;
//   systemPrompt: string;
//   ws?: WebSocket;
//   questionCount: number;      // track how many questions asked
//   maxQuestions: number;       // = 10
//   interviewEnded: boolean;
//   lastAnswerRating?: AnswerRating;
//   answerRatings: { question: number; score: number }[];
//   lastActivityAt: number;
//   silenceTimer?: ReturnType<typeof setTimeout>;
//   hasNudged: boolean;        // tracks if nudge already sent
//   skippedCount: number;      // optional: track total skips for scorecard

// }
// const sessions = new Map<string, Session>();

// app.use(cors());
// app.use(express.json());

// // ─── 1. REST — Upload Resume & Create Session ─────────────────────────────────
// app.post("/start-interview", upload.single("resume"), async (req, res) => {
//   try {
//     const parser = new PDFParse({
//       data: req.file!.buffer,
//     });

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

// // ─── 2. Stop Interview Early ──────────────────────────────────────────────────
// // POST /stop-interview  body: { sessionId: string }
// app.post("/stop-interview", async (req, res) => {
//   const { sessionId } = req.body as { sessionId?: string };

//   if (!sessionId || !sessions.has(sessionId)) {
//     return res.status(404).json({ error: "Session not found" });
//   }

//   const session = sessions.get(sessionId)!;

//   if (session.interviewEnded) {
//     return res.status(400).json({ error: "Interview already ended" });
//   }

//   session.interviewEnded = true;

//   res.json({ message: "Interview stop request received. Generating results…" });

//   // Fire-and-forget: generate scorecard + closing message and push via WS
//   finaliseInterview(session, /* stoppedEarly */ true).catch(console.error);
// });

// // ─── 2. WebSocket — Realtime Interview ───────────────────────────────────────
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

//   // Receive a complete audio clip from the user (recorded turn, not a stream)
//   ws.on("message", async (data: Buffer) => {
//     try {
//       // ── STT: transcribe via Gemini generateContent ─────────────────────────
//       // Gemini accepts inline audio up to 20 MB. For per-turn interview answers
//       // this is well within limits. For real-time streaming, use the Live API.
//       const base64Audio = data.toString("base64");

//       const sttResponse = await genai.models.generateContent({
//         model: "gemini-2.5-flash",
//         contents: [
//           {
//             role: "user",
//             parts: [
//               { text: "Transcribe this audio exactly. Return only the transcript, no commentary." },
//               { inlineData: { mimeType: "audio/webm", data: base64Audio } },
//             ],
//           },
//         ],
//       });

//       const userText = sttResponse.text?.trim() ?? "";

//       ws.send(JSON.stringify({ type: "transcript", role: "user", text: userText }));

//       await session.history.addMessage(new HumanMessage(userText));
//       await triggerAITurn(session);
//     } catch (err) {
//       console.error(err);
//       ws.send(JSON.stringify({ type: "error", message: "Failed to process audio" }));
//     }
//   });

//   ws.on("close", () => {
//     console.log(`WS disconnected: ${sessionId}`);
//     sessions.delete(sessionId);
//   });
// });

// // ─── AI Turn: LangChain LLM → Gemini TTS → send audio back ───────────────────
// async function triggerAITurn(session: Session, options: TurnOptions = {}) {
//   console.log("Triggering AI turn");
//   const ws = session.ws!;

//   if (session.interviewEnded) return;

//   const isOpening = session.questionCount === 0;
//   const reachedLimit: boolean = session.questionCount >= session.maxQuestions;

//   const statusNote =
//     reachedLimit
//       ? `Do NOT ask any more questions. Close the interview now.`
//       : `You have asked ${session.questionCount} out of ${session.maxQuestions} questions. You may ask ${session.maxQuestions - session.questionCount} more.`;
  
//   const skipInstruction = options.silenceSkip
//     ? `\n\nIMPORTANT: The candidate just stayed silent and did not answer twice.
// First acknowledge this warmly and empathetically in 1 sentence 
// (e.g. "That's okay, some concepts can be tricky — let's move on." 
// or "No worries at all, let's try a different angle.").
// DO NOT repeat the previous question.
// Then immediately ask your next interview question.
// Keep the entire response under 3 sentences.`
//     : "";    

//   const combinedSystemPrompt = `${session.systemPrompt}\n\nCURRENT STATUS: ${statusNote}`;

//   const pastMessages = await session.history.getMessages();

//   const contentMessages: BaseMessage[] =
//     isOpening
//       ? [new HumanMessage("Begin the interview. Greet the candidate and ask your first question.")]
//       : pastMessages;

//   const messages: BaseMessage[] = [
//     new SystemMessage(combinedSystemPrompt),
//     ...contentMessages,
//   ];

//   const aiResponse = await chatModel.invoke(messages);
//   const raw =
//     typeof aiResponse.content === "string"
//       ? aiResponse.content
//       : aiResponse.content
//         .filter((c) => c.type === "text")
//         .map((c) => (c as { type: "text"; text: string }).text)
//         .join("");

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
//     // Model didn't follow the JSON format — use raw text as reply
//     console.warn("AI response was not valid JSON, using raw text as reply.");
//   }

//   // Store the rating for the final scorecard
//   if (answerScore !== null && !isOpening) {
//     session.answerRatings.push({ question: session.questionCount, score: answerScore });
//   }

//   // Update last rating so it's available to the next turn's strategy hint
//   if (answerScore !== null) {
//     session.lastAnswerRating = {
//       score: answerScore,
//       isDetailed: answerScore >= 8,
//     };
//   }

//   await session.history.addMessage(new AIMessage(replyText));

//   if (!reachedLimit) {
//     session.questionCount++;
//   } else {
//     // Natural end after Q10
//     await finaliseInterview(session, false);
//     return;
//   }
//   ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: replyText }));

//   // ── TTS via Gemini native API ──────────────────────────────────────────────
//   // Model: gemini-2.5-flash-preview-tts  (free tier, same quota pool)
//   // Output: raw PCM  — 24 kHz, 16-bit, mono (L16 format)
//   // The frontend must wrap this in a WAV header before playing, or you can
//   // do it here. A minimal 44-byte WAV header is added below for convenience.
//   await speakText(replyText, ws);
// }

// async function speakText(text: string, ws: WebSocket) {
//   const ttsResponse = await genai.models.generateContent({
//     model: "gemini-2.5-flash-preview-tts",
//     contents: [{ role: "user", parts: [{ text }] }],
//     config: {
//       responseModalities: ["AUDIO"],
//       speechConfig: {
//         voiceConfig: {
//           prebuiltVoiceConfig: { voiceName: "Kore" }, // neutral interviewer voice
//         },
//       },
//     },
//   });

//   const pcmBase64 =
//     ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

//   if (!pcmBase64) {
//     ws.send(JSON.stringify({ type: "error", message: "TTS returned no audio" }));
//     return;
//   }

//   const pcmBuffer = Buffer.from(pcmBase64, "base64");
//   const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);

//   ws.send(JSON.stringify({ type: "audio_start" }));
//   ws.send(wavBuffer); // raw binary WAV frame
//   ws.send(JSON.stringify({ type: "audio_end" }));
// }

// async function handleSilenceTimeout(session: Session) {
//   const ws = session.ws!;
//   if (session.interviewEnded) return;

//   if (!session.hasNudged) {
//     // ── First timeout → send a simple nudge via TTS ──────────────────────
//     session.hasNudged = true;

//     const nudgeText = "Take your time — go ahead whenever you're ready.";
//     ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: nudgeText }));
//     await speakText(nudgeText, session);   // TTS only, no LLM call needed

//     // restart timer for second chance
//     clearTimeout(session.silenceTimer);
//     session.silenceTimer = setTimeout(async () => {
//       await handleSilenceTimeout(session);
//     }, 20000);

//   } else {
//     // ── Second timeout → LLM generates empathetic skip + next question ───
//     session.hasNudged = false;
//     session.skippedCount++;

//     // tell history what happened so LLM has context
//     await session.history.addMessage(
//       new HumanMessage("[The candidate did not respond to this question twice.]")
//     );

//     ws.send(JSON.stringify({ type: "transcript", role: "user", text: "(no response)" }));
//     ws.send(JSON.stringify({ type: "silence_skip" }));  // frontend can show a badge

//     // now call LLM with a special instruction so it generates
//     // an empathetic transition AND the next question in one response
//     await triggerAITurn(session, { silenceSkip: true });
//   }
// }

// // ─── Finalise: scorecard + closing message (natural end OR early stop) ────────
// async function finaliseInterview(session: Session, stoppedEarly: boolean) {
//   const ws = session.ws;
//   session.interviewEnded = true;

//   const allMessages = await session.history.getMessages();

//   // Build scorecard — one LLM call at end only
//   const scorecardResponse = await chatModel.invoke([
//     new SystemMessage(`Based on the interview conversation, generate a JSON scorecard. Return ONLY valid JSON, no markdown:
// {
//   "overallScore": <0-10>,
//   "strengths": ["..."],
//   "weaknesses": ["..."],
//   "topicScores": [{ "topic": "...", "score": <0-10> }],
//   "recommendation": "Strong Hire" | "Hire" | "No Hire",
//   "perAnswerScores": ${JSON.stringify(session.answerRatings)},
//   "summary": "<2-3 sentence overall assessment>"
// }`),
//     ...allMessages,
//   ]);

//   let scorecard: object = { perAnswerScores: session.answerRatings };
//   try {
//     const rawSc =
//       typeof scorecardResponse.content === "string"
//         ? scorecardResponse.content
//         : (scorecardResponse.content as { type: string; text?: string }[])
//           .filter((c) => c.type === "text")
//           .map((c) => c.text ?? "")
//           .join("");
//     scorecard = JSON.parse(rawSc.replace(/```json|```/g, "").trim());
//   } catch (e) {
//     console.error("Scorecard parse error:", e);
//   }

//   // Closing spoken message — reuse existing chatModel, no new client
//   const closingPrompt = stoppedEarly
//     ? "The candidate stopped the interview early. Acknowledge warmly, thank them, and say their results are now ready. Under 2 sentences."
//     : "All 10 questions are done. Thank the candidate warmly and let them know their results are ready. Under 2 sentences.";

//   const closingResponse = await chatModel.invoke([
//     new SystemMessage("You are a professional interviewer. Reply as plain spoken text only — no JSON, no markdown."),
//     new HumanMessage(closingPrompt),
//   ]);

//   const closingText =
//     typeof closingResponse.content === "string"
//       ? closingResponse.content
//       : (closingResponse.content as { type: string; text?: string }[])
//         .filter((c) => c.type === "text")
//         .map((c) => c.text ?? "")
//         .join("");

//   if (ws && ws.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: closingText }));
//     await speakText(closingText, ws);
//     ws.send(JSON.stringify({ type: "interview_complete", scorecard, stoppedEarly }));
//   }
// }

// // ─── Utility: wrap raw PCM (L16) in a WAV container ──────────────────────────
// // Gemini TTS returns headerless PCM; browsers need a WAV (or other) container.
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
//   header.writeUInt32LE(16, 16);          // PCM chunk size
//   header.writeUInt16LE(1, 20);           // PCM format
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