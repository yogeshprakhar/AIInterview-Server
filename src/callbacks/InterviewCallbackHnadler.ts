import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { BaseMessage } from "@langchain/core/messages";
import { LLMResult } from "@langchain/core/outputs";
import { metrics } from "../services/metrics";

// ─── Callback Handler — logs every LLM call ───────────────────────────────────
export class InterviewCallbackHandler extends BaseCallbackHandler {
  name = "InterviewCallbackHandler";

  async handleChatModelStart(
    // llm: { name: string },
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string
  ) {
    console.log("\n========== LLM CALL START ==========");
    console.log(`Model   : ${llm.name}`);
    console.log(`Run ID  : ${runId}`);
    console.log(`Messages in prompt: ${messages[0].length}`);
    messages[0].forEach((msg, i) => {
      const content =
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      console.log(
        `  [${i}] ${msg._getType().toUpperCase()}: ${content.slice(0, 120)}${content.length > 120 ? "…" : ""}`
      );
    });
    console.log("=====================================\n");
  }

  async handleLLMEnd(output: LLMResult, runId: string) {
    console.log("\n========== LLM CALL END ==========");
    console.log(`Run ID  : ${runId}`);
    const text = output.generations[0][0].text;
    console.log(`Response: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    if (output.llmOutput?.tokenUsage) {
      const { promptTokens, completionTokens, totalTokens } =
        output.llmOutput.tokenUsage;
      console.log(
        `Tokens — prompt: ${promptTokens}, completion: ${completionTokens}, total: ${totalTokens}`
      );
      metrics.totalPromptTokens += promptTokens ?? 0;
      metrics.totalCompletionTokens += completionTokens ?? 0;
    }
    console.log("==================================\n");
  }

  async handleLLMError(error: Error, runId: string) {
    console.error(`\n❌ LLM ERROR [${runId}]:`, error.message);
  }
}
