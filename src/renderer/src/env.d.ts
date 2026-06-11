/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron <webview> JSX element declaration.
// The tag is a real DOM element (Electron injects it), but TypeScript's lib.dom
// doesn't include it, so we augment the global JSX namespace here.
declare namespace JSX {
  interface IntrinsicElements {
    webview: {
      src?: string;
      style?: import("react").CSSProperties;
      ref?: import("react").Ref<HTMLElement & { reload: () => void }>;
      [key: string]: unknown;
    };
  }
}
