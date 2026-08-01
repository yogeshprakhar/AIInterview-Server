import express from "express";
import cors from "cors";
import { createServer } from "http";
import { attachInterviewSocket } from "./websocket/InterviewSocket";
import interviewRoutes from "./routes/InterviewRoutes";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(interviewRoutes);

  const server = createServer(app);
  attachInterviewSocket(server);

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return server;
}
