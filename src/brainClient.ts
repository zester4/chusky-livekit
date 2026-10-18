import { createHmac, randomUUID } from "node:crypto";
import type { LiveKitConfig } from "./config.js";
import type { LiveKitCallMetadata } from "./types.js";

export interface BrainQuestionResult {
  answer: string;
  approvalRequired: boolean;
  receiptId?: string;
  endCall: boolean;
}

interface BrainResponse {
  ok: boolean;
  answer?: unknown;
  approvalRequired?: unknown;
  receiptId?: unknown;
  endCall?: unknown;
  error?: unknown;
}

function cleanSpeech(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_500);
}

function signature(secret: string, timestamp: string, nonce: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex")}`;
}

export class BrainClient {
  constructor(private readonly config: LiveKitConfig, private readonly metadata: LiveKitCallMetadata) {}

  async ask(question: string, turnId: string, signal?: AbortSignal): Promise<BrainQuestionResult> {
    const normalized = cleanSpeech(question);
    if (!normalized) throw new Error("The voice question is empty");
    const body = JSON.stringify({
      version: 1,
      kind: "question",
      callId: this.metadata.callId,
      userId: this.metadata.userId,
      direction: this.metadata.direction,
      purpose: this.metadata.purpose,
      callProfile: this.metadata.callProfile,
      contactName: this.metadata.contactName,
      organization: this.metadata.organization,
      verification: this.metadata.verification,
      turnId: turnId.slice(0, 160),
      question: normalized,
    });
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.brainTimeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(this.config.brainUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chusky-LiveKit-Timestamp": timestamp,
          "X-Chusky-LiveKit-Nonce": nonce,
          "X-Chusky-LiveKit-Signature": signature(this.config.brainSecret, timestamp, nonce, body),
          "Idempotency-Key": `livekit:${this.metadata.callId}:${turnId.slice(0, 120)}`,
        },
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as BrainResponse;
      if (!response.ok || payload.ok !== true || typeof payload.answer !== "string") throw new Error("Chusky brain request failed");
      const answer = cleanSpeech(payload.answer);
      if (!answer) throw new Error("Chusky brain returned an empty answer");
      return {
        answer,
        approvalRequired: payload.approvalRequired === true,
        ...(typeof payload.receiptId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(payload.receiptId) ? { receiptId: payload.receiptId } : {}),
        endCall: payload.endCall === true,
      };
    } catch {
      throw new Error("The private assistant is temporarily unavailable");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function signForTest(secret: string, timestamp: string, nonce: string, body: string): string {
  return signature(secret, timestamp, nonce, body);
}

