import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { InterviewCallbackHandler } from "../callbacks/InterviewCallbackHnadler";
import { GOOGLE_API_KEY } from "../configs/env";

const callbackHandler = new InterviewCallbackHandler();

// ─── LangChain chat model ─────────────────────────────────────────────────────
export const chatModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: GOOGLE_API_KEY,
  temperature: 0.7,
  maxRetries: 3,
  callbacks: [callbackHandler], // ← attach callback handler
});