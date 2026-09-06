import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { ExtensionRequest, ExtensionResponse } from "../../src/messages";

async function send(request: ExtensionRequest): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(request);
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App send={send} />
    </StrictMode>,
  );
}
