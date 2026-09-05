import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: ({ mode }) => ({
    name: "Accessibility Inspector",
    description:
      "Deterministic, local accessibility findings for the active page.",
    permissions: ["activeTab", "scripting", "sidePanel", "storage"],
    action: { default_title: "Open Accessibility Inspector" },
    ...(mode === "test" ? { host_permissions: ["http://127.0.0.1/*"] } : {}),
  }),
});
