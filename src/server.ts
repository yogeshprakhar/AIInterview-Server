import { createApp } from "./app";

const server = createApp();

server.listen(8000, () => console.log("Server on :8000"));
