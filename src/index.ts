import { fileURLToPath } from "node:url";
import { cli, WorkerOptions } from "@livekit/agents";
import agent from "./agent.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

if (!config.enabled) {
  console.log(JSON.stringify({ level: "info", event: "livekit_disabled", agentName: config.agentName }));
} else {
  // Explicit agentName enables deterministic dispatch. The worker must be
  // assigned by the Chusky control plane; it never auto-joins arbitrary rooms.
  await cli.runApp(new WorkerOptions({
    agent: fileURLToPath(new URL("./agent.js", import.meta.url)),
    agentName: config.agentName,
    wsURL: config.url,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    logLevel: config.logLevel,
    production: config.deployment === "production",
  }));
}

