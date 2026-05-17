import { createRoot, type Root } from "react-dom/client";
import type { AnalyzeRequest } from "@shared/types/analysis";
import { App } from "./App";
import panelCss from "./Panel.css?inline";

const HOST_ID = "kg-panel-host";

interface MountOpts {
  request: AnalyzeRequest;
  onContinue: () => void;
  onPause: () => void;
  onClose: () => void;
}

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;

export function mountPanel(opts: MountOpts) {
  unmountPanel();

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = panelCss;
  shadow.appendChild(style);

  const mountNode = document.createElement("div");
  shadow.appendChild(mountNode);

  const root = createRoot(mountNode);
  activeRoot = root;
  activeHost = host;

  root.render(
    <App
      request={opts.request}
      onContinue={() => {
        unmountPanel();
        opts.onContinue();
      }}
      onPause={() => {
        unmountPanel();
        opts.onPause();
      }}
      onClose={() => {
        unmountPanel();
        opts.onClose();
      }}
    />,
  );
}

export function unmountPanel() {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeHost && activeHost.parentNode) {
    activeHost.parentNode.removeChild(activeHost);
    activeHost = null;
  }
}
