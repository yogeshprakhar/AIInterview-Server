// ─── Metrics ──────────────────────────────────────────────────────────────────
export const metrics = {
  totalLLMCalls: 0,
  totalSTTCalls: 0,
  totalTTSCalls: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,

  log() {
    console.log("\n📊 ===== METRICS =====");
    console.log(`LLM calls  : ${this.totalLLMCalls}`);
    console.log(`STT calls  : ${this.totalSTTCalls}`);
    console.log(`TTS calls  : ${this.totalTTSCalls}`);
    console.log(`Total API  : ${this.totalLLMCalls + this.totalSTTCalls + this.totalTTSCalls}`);
    console.log(`Prompt tokens     : ${this.totalPromptTokens}`);
    console.log(`Completion tokens : ${this.totalCompletionTokens}`);
    console.log("=====================\n");
  },
};
