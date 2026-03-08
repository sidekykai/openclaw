import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createWhatsAppCloudApiPlugin } from "./src/channel.js";
import { setWaCloudRuntime } from "./src/runtime.js";

const plugin = {
  id: "whatsapp-cloud-api",
  name: "WhatsApp Cloud API",
  description: "WhatsApp Business Cloud API channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWaCloudRuntime(api.runtime);
    api.registerChannel({ plugin: createWhatsAppCloudApiPlugin() });
  },
};

export default plugin;
