import React from "react";
import ReactDOM from "react-dom/client";

import {
  parseExtensionResponse,
  type ExtensionRequest,
} from "../../src/messages";
import App from "./App";
import type { AssistantSettingsV1 } from "../../src/ollama";

async function send(request: ExtensionRequest) {
  return parseExtensionResponse(await chrome.runtime.sendMessage(request));
}

async function requestPermission(settings: AssistantSettingsV1) {
  return chrome.permissions.request({ origins: [`http://${settings.host}/*`] });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App send={send} requestPermission={requestPermission} />
  </React.StrictMode>,
);
