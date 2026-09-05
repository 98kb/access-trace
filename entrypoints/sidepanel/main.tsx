import React from "react";
import ReactDOM from "react-dom/client";

import {
  parseExtensionResponse,
  type ExtensionRequest,
} from "../../src/messages";
import App from "./App";
import type { AssistantSettingsV1 } from "../../src/ollama";
import { TAB_STATE_KEY_PREFIX } from "../../src/tab-state";

async function send(request: ExtensionRequest) {
  return parseExtensionResponse(await chrome.runtime.sendMessage(request));
}

async function requestPermission(settings: AssistantSettingsV1) {
  return chrome.permissions.request({ origins: [`http://${settings.host}/*`] });
}

/**
 * Session storage is the only durable link to the background worker, so the
 * panel redraws from it after a suspend/restart or a page navigation.
 */
function subscribeToState(listener: () => void) {
  const onChanged = (changes: Record<string, unknown>) => {
    if (
      Object.keys(changes).some((key) => key.startsWith(TAB_STATE_KEY_PREFIX))
    )
      listener();
  };
  chrome.storage.session.onChanged.addListener(onChanged);
  const onFocus = () => listener();
  window.addEventListener("focus", onFocus);
  return () => {
    chrome.storage.session.onChanged.removeListener(onChanged);
    window.removeEventListener("focus", onFocus);
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App
      send={send}
      requestPermission={requestPermission}
      subscribeToState={subscribeToState}
    />
  </React.StrictMode>,
);
