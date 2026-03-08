/**
 * Inbound webhook handler for Meta WhatsApp Cloud API webhooks.
 * Handles GET verification and POST inbound messages.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { validateMetaSignature } from "./signature.js";
import type { ResolvedWaCloudAccount, MetaWebhookPayload, MetaWebhookMessage } from "./types.js";

/** Read the full request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 1_048_576; // 1MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send a JSON response. */
function respond(res: ServerResponse, statusCode: number, body: Record<string, unknown> | string) {
  if (typeof body === "string") {
    res.writeHead(statusCode, { "Content-Type": "text/plain" });
    res.end(body);
  } else {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
}

/** Parse query string from URL. */
function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Extract text messages from Meta webhook payload.
 * Returns an array of {from, body, senderName} for each text message.
 */
function extractMessages(
  payload: MetaWebhookPayload,
): Array<{ from: string; body: string; senderName: string; phoneNumberId: string }> {
  const messages: Array<{
    from: string;
    body: string;
    senderName: string;
    phoneNumberId: string;
  }> = [];

  if (!payload.entry) return messages;

  for (const entry of payload.entry) {
    if (!entry.changes) continue;
    for (const change of entry.changes) {
      const value = change.value;
      if (!value?.messages) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      const contacts = value.contacts ?? [];

      for (const msg of value.messages) {
        // Only handle text messages for now
        if (msg.type !== "text" || !msg.text?.body) continue;

        // Look up sender name from contacts
        const contact = contacts.find((c) => c.wa_id === msg.from);
        const senderName = contact?.profile?.name ?? msg.from;

        messages.push({
          from: msg.from,
          body: msg.text.body,
          senderName,
          phoneNumberId,
        });
      }
    }
  }

  return messages;
}

export interface WebhookHandlerDeps {
  account: ResolvedWaCloudAccount;
  deliver: (msg: {
    body: string;
    from: string;
    senderName: string;
    provider: string;
    chatType: string;
    sessionKey: string;
    accountId: string;
  }) => Promise<string | null>;
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Create an HTTP request handler for Meta WhatsApp Cloud API webhooks.
 *
 * Handles:
 * 1. GET — Meta webhook verification (hub.mode=subscribe)
 * 2. POST — Inbound messages with HMAC-SHA256 signature validation
 */
export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const { account, deliver, log } = deps;

  return async (req: IncomingMessage, res: ServerResponse) => {
    // GET — Meta webhook verification
    if (req.method === "GET") {
      const query = parseQuery(req.url ?? "");
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];

      if (mode === "subscribe" && token === account.verifyToken) {
        log?.info?.("Webhook verification successful");
        respond(res, 200, challenge ?? "");
        return;
      }

      log?.warn?.("Webhook verification failed: invalid verify_token or mode");
      respond(res, 403, { error: "Verification failed" });
      return;
    }

    // Only accept POST for messages
    if (req.method !== "POST") {
      respond(res, 405, { error: "Method not allowed" });
      return;
    }

    // Read body
    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      log?.error?.("Failed to read request body", err);
      respond(res, 400, { error: "Invalid request body" });
      return;
    }

    // Validate signature if appSecret is configured
    if (account.appSecret) {
      const signature = (req.headers["x-hub-signature-256"] as string) ?? "";
      if (!validateMetaSignature(body, signature, account.appSecret)) {
        log?.warn?.("Invalid webhook signature");
        respond(res, 401, { error: "Invalid signature" });
        return;
      }
    }

    // Parse payload
    let payload: MetaWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      respond(res, 400, { error: "Invalid JSON" });
      return;
    }

    // Ignore non-whatsapp events
    if (payload.object !== "whatsapp_business_account") {
      respond(res, 200, { status: "ignored" });
      return;
    }

    // Extract text messages
    const messages = extractMessages(payload);

    if (messages.length === 0) {
      // Status updates, read receipts, etc. — acknowledge silently
      respond(res, 200, { status: "ok" });
      return;
    }

    // Respond 200 immediately to avoid Meta timeout (20s)
    respond(res, 200, { status: "ok" });

    // Process each message asynchronously
    for (const msg of messages) {
      // DM policy check
      if (account.dmPolicy === "allowlist" && account.allowFrom.length > 0) {
        if (!account.allowFrom.includes(msg.from)) {
          log?.warn?.(`Blocked message from non-allowlisted sender: ${msg.from}`);
          continue;
        }
      }

      const preview = msg.body.length > 100 ? `${msg.body.slice(0, 100)}...` : msg.body;
      log?.info?.(`Message from ${msg.senderName} (${msg.from}): ${preview}`);

      try {
        const sessionKey = `whatsapp-cloud-api-${msg.from}`;
        await deliver({
          body: msg.body,
          from: msg.from,
          senderName: msg.senderName,
          provider: "whatsapp-cloud-api",
          chatType: "direct",
          sessionKey,
          accountId: account.accountId,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        log?.error?.(`Failed to process message from ${msg.senderName}: ${errMsg}`);
      }
    }
  };
}
