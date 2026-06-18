import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { WebSocket } from "ws";

export interface AnswerRating {
  score: number;
  isDetailed: boolean;
}

export interface TurnOptions {
  silenceSkip?: boolean;
}

export interface Session {
  history: InMemoryChatMessageHistory;
  systemPrompt: string;
  ws?: WebSocket;
  questionCount: number;
  maxQuestions: number;
  interviewEnded: boolean;
  lastAnswerRating?: AnswerRating;
  answerRatings: { question: number; score: number }[];
  lastActivityAt: number;
  silenceTimer?: ReturnType<typeof setTimeout>;
  hasNudged: boolean;
  skippedCount: number;
}
