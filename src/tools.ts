import { beta, llm } from "@livekit/agents";
import { z } from "zod";
import type { BrainClient } from "./brainClient.js";
import type { LiveKitConfig } from "./config.js";

export interface LiveKitToolState {
  brain: BrainClient;
  config: LiveKitConfig;
  turns: number;
  toolCalls: number;
}

export function createLiveKitTools(state: LiveKitToolState) {
  const consult = llm.tool<LiveKitToolState, z.ZodObject<{ question: z.ZodString }>, {
    answer: string;
    approvalRequired: boolean;
    receiptId?: string;
    endCall: boolean;
  }>({
    name: "consult_chusky",
    description: "Ask the private Chusky assistant to answer one focused question or perform one permitted action for this call. Use it for owner-approved memory, connected apps, scheduling, messages, CRM, research, and other work. Do not invent completion; only report a completed action when Chusky returns a receipt. Never send secrets or unrelated private data.",
    parameters: z.object({ question: z.string().trim().min(1).max(2_000) }),
    onDuplicate: "reject",
    execute: async ({ question }, { ctx, toolCallId, abortSignal }) => {
      state.toolCalls += 1;
      if (state.toolCalls > state.config.maxToolCalls) throw new Error("This call has reached its safe work limit");
      // Detach the tool from the current speech turn immediately. LiveKit then
      // lets the model acknowledge the work and continue listening while the
      // signed Chusky request runs in the background. The final result is
      // delivered as a deferred tool update, so callers do not wait silently.
      await ctx.update("I’m checking that now.", {
        template: "{message} Keep this brief and do not claim that the requested action is complete yet.",
      });
      return state.brain.ask(question, toolCallId, abortSignal);
    },
  });
  return [consult, beta.createEndCallTool({ deleteRoom: true, ignoreOnEnter: true })] as const;
}

