/**
 * Plugin runtime singleton.
 * Stores the PluginRuntime from api.runtime (set during register()).
 * Used by channel.ts to access dispatch functions.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWaCloudRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getWaCloudRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WhatsApp Cloud API runtime not initialized - plugin not registered");
  }
  return runtime;
}
