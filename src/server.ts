import { createApp } from "./app";

const server = createApp();

const PORT = process.env.PORT ?? 8000;
server.listen(PORT, () => console.log(`Server on :${PORT}`));

