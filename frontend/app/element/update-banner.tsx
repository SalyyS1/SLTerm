// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Global Rem Aqua In-App GitHub Release Update Banner for SLTerm.
// Automatically checks `SalyyS1/SLTerm` GitHub Releases 3s after launch and responds
// to manual `slterm:check-update` events from ADE Hub, Status Bar, or Ctrl+Shift+P.

import { createBlock } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as React from "react";
import { useTranslation } from "react-i18next";
import "./update-banner.scss";

const DISMISS_KEY = "slterm-dismissed-update-ver";
export const CHECK_UPDATE_EVENT = "slterm:check-update";

export function triggerManualUpdateCheck(): void {
    window.dispatchEvent(new CustomEvent(CHECK_UPDATE_EVENT));
}

export const UpdateBanner: React.FC = () => {
    const { t } = useTranslation();
    const [info, setInfo] = React.useState<AdeUpdateInfoData | null>(null);
    const [visible, setVisible] = React.useState(false);
    const [statusNote, setStatusNote] = React.useState<string | null>(null);
    const [progress, setProgress] = React.useState<AdeUpdateProgressData | null>(null);

    React.useEffect(() => {
        if (!progress?.active) return;
        const iv = setInterval(async () => {
            try {
                const st = await RpcApi.AdeGetUpdateProgressCommand(TabRpcClient);
                setProgress(st);
            } catch {
                // ignore transient poll errors
            }
        }, 400);
        return () => clearInterval(iv);
    }, [progress?.active]);

    const startAutoUpdate = async () => {
        if (!info?.downloadUrl) {
            if (info?.releaseUrl) openUrl(info.releaseUrl);
            return;
        }
        try {
            const st = await RpcApi.AdeStartSelfUpdateCommand(TabRpcClient, {
                downloadUrl: info.downloadUrl,
                version: info.latestVersion,
            });
            setProgress(st);
        } catch (err) {
            setStatusNote(`Auto-update error: ${String(err)}`);
        }
    };

    const runCheck = React.useCallback(async (force: boolean) => {
        try {
            const res = await RpcApi.AdeCheckUpdateCommand(TabRpcClient, { force });
            setInfo(res);
            if (res?.updateAvailable) {
                const dismissed = localStorage.getItem(DISMISS_KEY);
                if (force || dismissed !== res.latestVersion) {
                    setVisible(true);
                }
                setStatusNote(null);
            } else if (force && res) {
                setStatusNote(`✓ SLTerm v${res.currentVersion} ${t("ade.upToDate", "is up to date!")}`);
                setVisible(true);
                setTimeout(() => setVisible(false), 4200);
            }
        } catch (err) {
            if (force) {
                setStatusNote(`Update check failed: ${String(err)}`);
                setVisible(true);
                setTimeout(() => setVisible(false), 4500);
            }
        }
    }, []);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            void runCheck(false);
        }, 3000);
        const onManual = () => {
            void runCheck(true);
        };
        window.addEventListener(CHECK_UPDATE_EVENT, onManual);
        return () => {
            clearTimeout(timer);
            window.removeEventListener(CHECK_UPDATE_EVENT, onManual);
        };
    }, [runCheck]);

    if (!visible) {
        return null;
    }

    const openUrl = (url: string) => {
        if (!url) return;
        try {
            window.open(url, "_blank", "noopener,noreferrer");
        } catch {
            void createBlock({ meta: { view: "web", url } });
        }
    };

    return (
        <div className="rem-update-banner" role="status" aria-live="polite">
            {info?.updateAvailable ? (
                <>
                    <div className="rem-update-text">
                        <span className="rem-update-pill">v{info.latestVersion}</span>
                        <strong>
                            {progress?.stage === "downloading"
                                ? `Downloading SLTerm v${info.latestVersion} (${progress.percent}%)…`
                                : progress?.stage === "launched"
                                ? `✓ Updater launched for v${info.latestVersion}!`
                                : progress?.stage === "error"
                                ? `Update error: ${progress.error}`
                                : t("ade.updateAvailable", "New SLTerm release available on GitHub!")}
                        </strong>
                        <span className="rem-update-meta">
                            {progress?.stage === "downloading" && progress.totalBytes > 0
                                ? `${(progress.downloadedBytes / 1048576).toFixed(1)} / ${(progress.totalBytes / 1048576).toFixed(1)} MB`
                                : `(v${info.currentVersion})`}
                        </span>
                        {progress?.stage === "downloading" && (
                            <div className="rem-update-progress">
                                <div className="rem-update-progress-fill" style={{ width: `${progress.percent}%` }} />
                            </div>
                        )}
                    </div>
                    <div className="rem-update-actions">
                        <button
                            className="rem-update-btn primary"
                            disabled={progress?.active}
                            onClick={() => void startAutoUpdate()}
                        >
                            {progress?.active
                                ? `⏳ ${progress.percent}%`
                                : `⚡ ${t("ade.downloadUpdate", "Update Now")}`}
                        </button>
                        <button className="rem-update-btn" onClick={() => openUrl(info.releaseUrl)}>
                            {t("ade.viewRelease", "View Release")}
                        </button>
                        <button
                            className="rem-update-btn"
                            title="Dismiss until next version"
                            onClick={() => {
                                setVisible(false);
                                if (info.latestVersion) {
                                    localStorage.setItem(DISMISS_KEY, info.latestVersion);
                                }
                            }}
                        >
                            ×
                        </button>
                    </div>
                </>
            ) : (
                <div className="rem-update-text">
                    <span className="rem-update-pill ok">UP TO DATE</span>
                    <span>{statusNote}</span>
                </div>
            )}
        </div>
    );
};
