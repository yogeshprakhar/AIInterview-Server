import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { sessions } from "../store/sessionStore";
import { finaliseInterview } from "../services/InterviewService";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── 1. REST — Upload Resume & Create Session ─────────────────────────────────
router.post("/start-interview", upload.single("resume"), async (req, res) => {
  try {
    const parser = new PDFParse({ data: req.file!.buffer });
    const pdf = await parser.getText();
    console.log(pdf.text);
    await parser.destroy();

    const systemPrompt = `You are a strict but fair technical interviewer conducting a structured interview.

RESPONSE FORMAT — you MUST always reply with this exact JSON structure (no markdown, no extra keys):
{
  "reply": "<your spoken response — max 3 sentences>",
  "answerScore": <integer 0-10 rating of the candidate's last answer, or null on the opening greeting>,
  "nextStrategy": "deeper" | "new_topic" | "opening"
}

RULES:
1. Ask exactly ONE question per turn. Never ask two questions at once.
2. You will ask a TOTAL of 10 questions. No more.
3. Acknowledge the candidate's answer naturally in "reply" before asking the next question.
4. Decide "nextStrategy" based on "answerScore":
   - Score >= 8  → "deeper"    (follow up on the same topic or something they mentioned)
   - Score < 8   → "new_topic" (switch to a different topic from the resume)
   - Opening     → "opening"   (no answer yet)
5. After the 10th answer, do NOT ask another question — give a brief closing statement.

RESUME:
${pdf.text}`;

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      history: new InMemoryChatMessageHistory(),
      systemPrompt,
      questionCount: 0,
      maxQuestions: 10,
      interviewEnded: false,
      answerRatings: [],
      lastActivityAt: Date.now(),
      hasNudged: false,
      skippedCount: 0,
    });

    res.json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process resume" });
  }
});

// ─── 2. REST — Stop Interview Early ──────────────────────────────────────────
router.post("/stop-interview", async (req, res) => {
  console.log('sessionId', req.body);
  const { sessionId } = req.body as { sessionId?: string };

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessions.get(sessionId)!;

  if (session.interviewEnded) {
    return res.status(400).json({ error: "Interview already ended" });
  }

  // cancel any pending silence timer
  clearTimeout(session.silenceTimer);

  session.interviewEnded = true;
  res.json({ message: "Interview stop request received. Generating results…" });

  finaliseInterview(session, true).catch(console.error);
});

// Health Check
router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

export default router;