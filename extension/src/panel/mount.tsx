import { createRoot, type Root } from "react-dom/client";
import type { AnalyzeRequest } from "@shared/types/analysis";
import { App } from "./App";
import { OnboardingPanel } from "./OnboardingPanel";
import panelCss from "./Panel.css?inline";

const HOST_ID = "kg-panel-host";

interface MountOpts {
  request: AnalyzeRequest;
  onContinue: () => void;
  onPause: () => void;
  onClose: () => void;
}

interface OnboardingMountOpts {
  onFinish: () => void;
}

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;

function makeShadowMount(): HTMLDivElement {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = panelCss;
  shadow.appendChild(style);

  const mountNode = document.createElement("div");
  shadow.appendChild(mountNode);

  activeHost = host;
  return mountNode;
}

export function mountPanel(opts: MountOpts) {
  unmountPanel();
  const mountNode = makeShadowMount();
  const root = createRoot(mountNode);
  activeRoot = root;

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

export function mountOnboarding(opts: OnboardingMountOpts) {
  // Onboarding takes priority over any existing panel — but the analyze
  // panel only mounts on a buy-button click, and the onboarding fires at
  // document_idle, so in practice they never collide. Still: unmount any
  // stray host first so we never get two shadow roots side-by-side.
  unmountPanel();
  const mountNode = makeShadowMount();
  const root = createRoot(mountNode);
  activeRoot = root;

  const finish = () => {
    opts.onFinish();
    unmountPanel();
  };

  root.render(
    <OnboardingPanel onFinish={finish} onDismiss={finish} />,
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
