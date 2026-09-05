import React from "react";
import ReactDOM from "react-dom/client";

import {
  parseExtensionResponse,
  type ExtensionRequest,
} from "../../src/messages";
import App from "./App";

async function send(request: ExtensionRequest) {
  return parseExtensionResponse(await chrome.runtime.sendMessage(request));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App send={send} />
  </React.StrictMode>,
);
