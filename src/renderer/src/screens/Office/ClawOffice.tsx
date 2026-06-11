import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface ClawOfficeProps {
  profile?: string;
  visible?: boolean;
}

type Phase =
  | "idle"
  | "checking"
  | "setting-up"
  | "starting"
  | "waiting"
  | "ready"
  | "error";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // ~60 s total

function ClawOffice({ profile, visible }: ClawOfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [port, setPort] = useState<number | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState(false);

  // We only call .reload() and .addEventListener/.removeEventListener on the
  // webview element. Cast to HTMLElement with a reload method so we stay
  // within the renderer's type scope (Electron.WebviewTag lives in the main
  // process / preload scope, not here).
  const webviewRef = useRef<(HTMLElement & { reload: () => void }) | null>(null);
  const startedOnce = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubSetupProgress = useRef<(() => void) | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startClaw3d = useCallback(async () => {
    setPhase("checking");
    setWebviewReady(false);
    setWebviewError(false);
    setStatusMsg(t("office.checkingStatus"));

    let status: Awaited<ReturnType<typeof window.hermesAPI.claw3dStatus>>;
    try {
      status = await window.hermesAPI.claw3dStatus();
    } catch (err) {
      setPhase("error");
      setStatusMsg(String(err));
      return;
    }

    if (!status.installed) {
      setPhase("setting-up");
      setStatusMsg(t("office.installTitle"));

      unsubSetupProgress.current =
        window.hermesAPI.onClaw3dSetupProgress((p) => {
          setStatusMsg(`${p.title} — ${p.detail}`);
        });

      const setupResult = await window.hermesAPI.claw3dSetup();
      unsubSetupProgress.current?.();
      unsubSetupProgress.current = null;

      if (!setupResult.success) {
        setPhase("error");
        setStatusMsg(setupResult.error ?? t("office.setupFailed"));
        return;
      }
    }

    if (status.running) {
      const resolvedPort = status.port;
      setPort(resolvedPort);
      setPhase("ready");
      return;
    }

    setPhase("starting");
    setStatusMsg(t("office.starting"));

    const startResult = await window.hermesAPI.claw3dStartAll(profile);
    if (!startResult.success) {
      setPhase("error");
      setStatusMsg(startResult.error ?? t("office.startFailed"));
      return;
    }

    setPhase("waiting");
    setStatusMsg(t("office.waitingToStart"));

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const s = await window.hermesAPI.claw3dStatus();
        if (s.running && s.port) {
          clearPoll();
          setPort(s.port);
          setPhase("ready");
          return;
        }
      } catch {
        // transient; keep polling
      }
      if (attempts >= POLL_MAX_ATTEMPTS) {
        clearPoll();
        setPhase("error");
        setStatusMsg(t("office.cannotLoadClaw3d"));
      }
    }, POLL_INTERVAL_MS);
  }, [profile, t, clearPoll]);

  // Trigger on first visible mount only
  useEffect(() => {
    if (!visible) return;
    if (startedOnce.current) return;
    startedOnce.current = true;
    void startClaw3d();
    return () => {
      clearPoll();
      unsubSetupProgress.current?.();
    };
  }, [visible, startClaw3d, clearPoll]);

  // Wire webview events after port is known and webview mounts
  useEffect(() => {
    if (phase !== "ready" || !port) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const onFinish = (): void => setWebviewReady(true);
    const onDomReady = (): void => setWebviewReady(true);
    const onFailLoad = (): void => {
      setWebviewError(true);
    };

    wv.addEventListener("did-finish-load", onFinish);
    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-fail-load", onFailLoad);

    return () => {
      wv.removeEventListener("did-finish-load", onFinish);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-fail-load", onFailLoad);
    };
  }, [phase, port]);

  const handleRetry = useCallback(() => {
    clearPoll();
    startedOnce.current = false;
    setPort(null);
    setWebviewReady(false);
    setWebviewError(false);
    void startClaw3d();
    startedOnce.current = true;
  }, [clearPoll, startClaw3d]);

  const isLoading =
    phase === "idle" ||
    phase === "checking" ||
    phase === "setting-up" ||
    phase === "starting" ||
    phase === "waiting" ||
    (phase === "ready" && !webviewReady && !webviewError);

  const officeUrl = port ? `http://localhost:${port}/office` : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {t("navigation.clawOffice")}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t("office.loadingClaw3d")}
          </span>
        </div>

        {phase === "ready" && (
          <button
            type="button"
            onClick={() => {
              const wv = webviewRef.current;
              if (wv) {
                setWebviewReady(false);
                setWebviewError(false);
                wv.reload();
              }
            }}
            title={t("common.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <RefreshCw size={14} />
            {t("common.refresh")}
          </button>
        )}
      </header>

      {/* Body */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {/* Loading overlay */}
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              background: "var(--bg, #07080d)",
              zIndex: 2,
            }}
          >
            <RefreshCw
              size={28}
              style={{
                animation: "spin 1.2s linear infinite",
                opacity: 0.7,
              }}
            />
            <span style={{ fontSize: 14, opacity: 0.75 }}>
              {statusMsg || t("office.checkingStatus")}
            </span>
          </div>
        )}

        {/* Error state */}
        {(phase === "error" || webviewError) && !isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              background: "var(--bg, #07080d)",
              zIndex: 2,
            }}
          >
            <span
              style={{ fontSize: 14, opacity: 0.75, color: "#ef4444" }}
            >
              {statusMsg || t("office.cannotLoadClaw3d")}
            </span>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 18px",
                borderRadius: 8,
                border: "1px solid var(--border, rgba(0,0,0,0.12))",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <RefreshCw size={14} />
              {t("common.retry")}
            </button>
          </div>
        )}

        {/* Webview */}
        {officeUrl && phase === "ready" && !webviewError && (
          <webview
            ref={webviewRef}
            src={officeUrl}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              opacity: webviewReady ? 1 : 0,
            }}
          />
        )}
      </div>
    </div>
  );
}

export default ClawOffice;
