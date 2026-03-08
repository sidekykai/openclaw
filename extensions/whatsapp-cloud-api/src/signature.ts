/**
 * HMAC-SHA256 webhook signature validation for Meta webhooks.
 * Meta sends X-Hub-Signature-256 header as "sha256=<hex_digest>".
 */

import crypto from "node:crypto";

/**
 * Validate Meta webhook signature.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param body - Raw request body string
 * @param signature - Value of X-Hub-Signature-256 header (e.g. "sha256=abc123...")
 * @param appSecret - The app secret used as HMAC key
 * @returns true if signature is valid
 */
export function validateMetaSignature(body: string, signature: string, appSecret: string): boolean {
  if (!body || !signature || !appSecret) return false;

  // Meta format: "sha256=<hex>"
  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) return false;

  const receivedHex = signature.slice(prefix.length);
  const expectedHex = crypto.createHmac("sha256", appSecret).update(body).digest("hex");

  const receivedBuffer = Buffer.from(receivedHex, "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}
