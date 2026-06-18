import { GoogleGenAI } from "@google/genai";
import { GOOGLE_API_KEY } from "../configs/env";

// ─── Native Google GenAI client — STT + TTS ───────────────────────────────────
export const genai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });