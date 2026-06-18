import { WebSocket } from "ws";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { chatModel } from "../clients/geminiChat";
import { speakText } from "./ttsService";
import { metrics } from "./metrics";
import { Session, TurnOptions } from "../types";

// ─── AI Turn: LangChain LLM → Gemini TTS → send audio back ───────────────────
export async function triggerAITurn(session: Session, options: TurnOptions = {}) {
  console.log("Triggering AI turn");
  const ws = session.ws!;

  if (session.interviewEnded) return;

  const isOpening = session.questionCount === 0;
  const reachedLimit = session.questionCount >= session.maxQuestions;

  const statusNote = reachedLimit
    ? `Do NOT ask any more questions. Close the interview now.`
    : `You have asked ${session.questionCount} out of ${session.maxQuestions} questions. You may ask ${session.maxQuestions - session.questionCount} more.`;

  // ✅ FIX: skipInstruction is now actually included in the prompt
  //   const skipInstruction = options.silenceSkip
  //     ? `\n\nIMPORTANT: The candidate just stayed silent and did not answer twice.
  // First acknowledge this warmly and empathetically in 1 sentence
  // (e.g. "That's okay, some concepts can be tricky — let's move on."
  // or "No worries at all, let's try a different angle.").
  // DO NOT repeat the previous question.
  // Then immediately ask your next interview question.
  // Keep the entire response under 3 sentences.`
  //     : "";

  // ✅ combinedSystemPrompt
  const combinedSystemPrompt = `${session.systemPrompt}\n\nCURRENT STATUS: ${statusNote}`;

  const pastMessages = await session.history.getMessages();

  const contentMessages: BaseMessage[] = isOpening
    ? [new HumanMessage("Begin the interview. Greet the candidate and ask your first question.")]
    : pastMessages;

  const messages: BaseMessage[] = [
    new SystemMessage(combinedSystemPrompt),
    ...contentMessages,
  ];

  // ── LLM call ──────────────────────────────────────────────────────────────
  metrics.totalLLMCalls++;
  console.log(
    `\n🤖 LLM call #${metrics.totalLLMCalls} | questionCount: ${session.questionCount}`
  );

  const aiResponse = await chatModel.invoke(messages);

  // capture token usage if returned
  if ((aiResponse as any).response_metadata?.tokenUsage) {
    const { promptTokens, completionTokens } =
      (aiResponse as any).response_metadata.tokenUsage;
    metrics.totalPromptTokens += promptTokens ?? 0;
    metrics.totalCompletionTokens += completionTokens ?? 0;
  }

  const raw =
    typeof aiResponse.content === "string"
      ? aiResponse.content
      : aiResponse.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; text: string }).text)
          .join("");

  // ── Parse JSON response ────────────────────────────────────────────────────
  let replyText = raw;
  let answerScore: number | null = null;
  let nextStrategy: "deeper" | "new_topic" | "opening" = "new_topic";

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
      reply: string;
      answerScore: number | null;
      nextStrategy: "deeper" | "new_topic" | "opening";
    };
    replyText = parsed.reply;
    answerScore = parsed.answerScore;
    nextStrategy = parsed.nextStrategy;
  } catch {
    console.warn("AI response was not valid JSON, using raw text as reply.");
  }

  // Store rating for scorecard
  if (answerScore !== null && !isOpening) {
    session.answerRatings.push({ question: session.questionCount, score: answerScore });
  }

  if (answerScore !== null) {
    session.lastAnswerRating = {
      score: answerScore,
      isDetailed: answerScore >= 8,
    };
  }

  await session.history.addMessage(new AIMessage(replyText));

  if (reachedLimit) {
    // Natural end after Q10
    await finaliseInterview(session, false);
    return;
  }

  session.questionCount++;

  // ── TTS ────────────────────────────────────────────────────────────────────
  await speakText(replyText, ws);
  ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: replyText }));

  // ✅ FIX: start silence watchdog AFTER every AI turn
  // clearTimeout(session.silenceTimer);
  // session.silenceTimer = setTimeout(async () => {
  //   await handleSilenceTimeout(session);
  // }, 20000);

  metrics.log();
}

// ─── Silence Timeout Handler ──────────────────────────────────────────────────
// async function handleSilenceTimeout(session: Session) {
//   const ws = session.ws!;
//   if (session.interviewEnded) return;
//
//   if (!session.hasNudged) {
//     // ── First timeout → gentle nudge, no LLM call ─────────────────────────
//     session.hasNudged = true;
//
//     const nudgeText = "Take your time — go ahead whenever you're ready.";
//     ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: nudgeText }));
//
//     // ✅ FIX: pass ws not session to speakText
//     await speakText(nudgeText, ws);
//
//     // restart timer for second chance
//     clearTimeout(session.silenceTimer);
//     session.silenceTimer = setTimeout(async () => {
//       await handleSilenceTimeout(session);
//     }, 20000);
//   } else {
//     // ── Second timeout → LLM generates empathetic skip + next question ────
//     session.hasNudged = false;
//     session.skippedCount++;
//
//     await session.history.addMessage(
//       new HumanMessage("[The candidate did not respond to this question twice.]")
//     );
//
//     ws.send(JSON.stringify({ type: "transcript", role: "user", text: "(no response)" }));
//     ws.send(JSON.stringify({ type: "silence_skip" }));
//
//     await triggerAITurn(session, { silenceSkip: true });
//   }
// }

// ─── Finalise: scorecard + closing message ────────────────────────────────────
export async function finaliseInterview(session: Session, stoppedEarly: boolean) {
  const ws = session.ws;
  session.interviewEnded = true;
  clearTimeout(session.silenceTimer); // cancel any pending timer

  const allMessages = await session.history.getMessages();

  // ── Scorecard ──────────────────────────────────────────────────────────────
  const scorecardResponse = await chatModel.invoke([
    new SystemMessage(`Based on the interview conversation, generate a JSON scorecard. Return ONLY valid JSON, no markdown:
{
  "overallScore": <0-10>,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "topicScores": [{ "topic": "...", "score": <0-10> }],
  "recommendation": "Strong Hire" | "Hire" | "No Hire",
  "perAnswerScores": ${JSON.stringify(session.answerRatings)},
  "skippedQuestions": ${session.skippedCount},
  "summary": "<2-3 sentence overall assessment>"
}`),
    ...allMessages,
  ]);

  let scorecard: object = {
    perAnswerScores: session.answerRatings,
    skippedQuestions: session.skippedCount,
  };
  try {
    const rawSc =
      typeof scorecardResponse.content === "string"
        ? scorecardResponse.content
        : (scorecardResponse.content as { type: string; text?: string }[])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
    scorecard = JSON.parse(rawSc.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("Scorecard parse error:", e);
  }

  // ── Closing spoken message ─────────────────────────────────────────────────
  const closingPrompt = stoppedEarly
    ? "The candidate stopped the interview early. Acknowledge warmly, thank them, and say their results are now ready. Under 2 sentences."
    : "All 10 questions are done. Thank the candidate warmly and let them know their results are ready. Under 2 sentences.";

  const closingResponse = await chatModel.invoke([
    new SystemMessage(
      "You are a professional interviewer. Reply as plain spoken text only — no JSON, no markdown."
    ),
    new HumanMessage(closingPrompt),
  ]);

  const closingText =
    typeof closingResponse.content === "string"
      ? closingResponse.content
      : (closingResponse.content as { type: string; text?: string }[])
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("");

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: closingText }));
    await speakText(closingText, ws);
    ws.send(JSON.stringify({ type: "interview_complete", scorecard, stoppedEarly }));
  }

  console.log("\n🏁 Interview finalised — final metrics:");
  metrics.log();
}
