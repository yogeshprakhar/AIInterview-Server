import { WebSocketServer } from "ws";
import { Server as HttpServer } from "http";
import { HumanMessage } from "@langchain/core/messages";
import { sessions } from "../store/sessionStore";
import { triggerAITurn } from "../services/InterviewService";
import { metrics } from "../services/metrics";
import { transcribeAudio } from "../services/sstService";
// import { sessions } from "../store/sessionStore";
// import { transcribeAudio } from "../services/sttService";
// import { triggerAITurn } from "../services/interviewService";
// import { metrics } from "../services/metrics";

export function attachInterviewSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    console.log("WS connection received");
    const sessionId = req.url?.split("/interview/")[1];

    if (!sessionId || !sessions.has(sessionId)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid session" }));
      ws.close();
      return;
    }

    const session = sessions.get(sessionId)!;
    session.ws = ws;
    console.log(`WS connected: ${sessionId}`);

    // Kick off the interview — AI greets and asks first question
    triggerAITurn(session);

    ws.on("message", async (data: Buffer) => {
      try {
        // ── Check if this is a JSON signal (not audio binary) ────────────────
        // try {
        //   const signal = JSON.parse(data.toString());
        //   // if (signal.type === "silence_timeout") {
        //   //   await handleSilenceTimeout(session);
        //   //   return;
        //   // }
        // } catch {
        //   // not JSON — it's audio binary, fall through
        // }

        // ── Cancel silence watchdog — user is responding ─────────────────────
        clearTimeout(session.silenceTimer);           // ✅ FIX: was missing
        session.lastActivityAt = Date.now();
        session.hasNudged = false;                    // ✅ FIX: reset nudge state

        const userText = await transcribeAudio(data);
        ws.send(JSON.stringify({ type: "transcript", role: "user", text: userText }));

        await session.history.addMessage(new HumanMessage(userText));
        await triggerAITurn(session);
      } catch (err: any) {
        console.error(err);
        if (err?.status === 503) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "AI is busy right now — please try again in a moment.",
            })
          );
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Failed to process audio" }));
        }
      }
    });

    ws.on("close", () => {
      console.log(`WS disconnected: ${sessionId}`);
      clearTimeout(session.silenceTimer); // clean up timer on disconnect
      console.log("\n🏁 Session ended — final metrics:");
      metrics.log();
      sessions.delete(sessionId);
    });
  });

  return wss;
}
