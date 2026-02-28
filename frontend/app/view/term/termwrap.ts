// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    atoms,
    fetchWaveFile,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    openLink,
    setTabIndicator,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { WebLinksAddon } from "@xterm/addon-web-links";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import { FitAddon } from "./fitaddon";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import { createTempFileFromBlob, extractAllClipboardData } from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;

// Cached resolved promise to avoid GC pressure from creating new ones per write
const RESOLVED_PROMISE: Promise<void> = Promise.resolve();

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
};

// BatchedWriter coalesces terminal output writes using requestAnimationFrame
// to align with display refresh and reduce render calls under high-throughput scenarios.
// Caps each flush at MAX_BATCH_BYTES (128KB) to prevent huge merged writes from blocking.
// Applies backpressure: if xterm is still processing a previous write, defers the next flush.
// Only OUTPUT writes go through this — input (sendDataHandler) is never batched.
class BatchedWriter {
    private buffer: (string | Uint8Array)[] = [];
    private bufferBytes: number = 0;
    private rafId: number | null = null;
    private readonly MAX_BATCH_SIZE = 100;
    private readonly MAX_BATCH_BYTES = 128 * 1024; // 128KB max per flush — keeps terminal.write() responsive
    private pendingWrites: number = 0;
    private readonly MAX_PENDING_WRITES = 3; // backpressure: max concurrent xterm.write() in flight

    constructor(private terminal: Terminal) {}

    write(data: string | Uint8Array): void {
        this.buffer.push(data);
        this.bufferBytes += data.length;
        if (this.buffer.length >= this.MAX_BATCH_SIZE || this.bufferBytes >= this.MAX_BATCH_BYTES) {
            // Immediate flush when size thresholds exceeded
            this.flush();
        } else if (this.rafId == null) {
            // Schedule flush aligned with display refresh (typically ~16ms)
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null;
                this.flush();
            });
        }
    }

    flush(): void {
        if (this.buffer.length === 0) {
            if (this.rafId != null) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            return;
        }

        // Backpressure: if xterm is still processing previous writes, defer
        if (this.pendingWrites >= this.MAX_PENDING_WRITES) {
            dlog("backpressure — deferring flush, pending:", this.pendingWrites);
            // Re-schedule for next frame
            if (this.rafId == null) {
                this.rafId = requestAnimationFrame(() => {
                    this.rafId = null;
                    this.flush();
                });
            }
            return;
        }

        const chunks = this.buffer;
        const bytesFlushed = this.bufferBytes;
        this.buffer = [];
        this.bufferBytes = 0;

        let merged: string | Uint8Array;
        if (chunks.length === 1) {
            merged = chunks[0];
        } else {
            // Consolidate all chunks into a single string for one terminal.write() call
            const decoder = new TextDecoder();
            let str = "";
            for (const chunk of chunks) {
                str += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
            }
            merged = str;
        }

        this.pendingWrites++;
        this.terminal.write(merged as any, () => {
            this.pendingWrites--;
            // If data accumulated during backpressure, flush now
            if (this.buffer.length > 0 && this.rafId == null) {
                this.rafId = requestAnimationFrame(() => {
                    this.rafId = null;
                    this.flush();
                });
            }
        });

        dlog("flush", chunks.length, "chunks", bytesFlushed, "bytes, pending:", this.pendingWrites);

        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    dispose(): void {
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // Final synchronous flush — ignore backpressure on dispose
        if (this.buffer.length > 0) {
            const chunks = this.buffer;
            this.buffer = [];
            this.bufferBytes = 0;
            if (chunks.length === 1) {
                this.terminal.write(chunks[0] as any);
            } else {
                const decoder = new TextDecoder();
                let str = "";
                for (const chunk of chunks) {
                    str += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
                }
                this.terminal.write(str);
            }
        }
    }
}

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    // Lazy-loaded addons (null until first use)
    searchAddon: import("@xterm/addon-search").SearchAddon | null;
    serializeAddon: import("@xterm/addon-serialize").SerializeAddon | null;
    webglAddon: import("@xterm/addon-webgl").WebglAddon | null;
    batchedWriter: BatchedWriter;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    private toDispose: TermTypes.IDisposable[] = [];
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    nodeModel: BlockNodeModel; // this can be null

    // IME composition state tracking
    // Prevents duplicate input when switching input methods during composition (e.g., using Capslock)
    // xterm.js sends data during compositionupdate AND after compositionend, causing duplicates
    isComposing: boolean = false;
    composingData: string = "";
    lastCompositionEnd: number = 0;
    lastComposedText: string = "";
    firstDataAfterCompositionSent: boolean = false;

    // Idle timeout tracking
    private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private disposed: boolean = false;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.fitAddon.noScrollbar = PLATFORM === PlatformMacOS;
        // Lazy addons — loaded on demand
        this.searchAddon = null;
        this.serializeAddon = null;
        this.webglAddon = null;
        this.batchedWriter = new BatchedWriter(this.terminal);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(
            new WebLinksAddon((e, uri) => {
                e.preventDefault();
                switch (PLATFORM) {
                    case PlatformMacOS:
                        if (e.metaKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                    default:
                        if (e.ctrlKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                }
            })
        );
        if (WebGLSupported && waveOptions.useWebGl) {
            // attachWebGL is async — fire-and-forget; canvas renderer active until it resolves
            fireAndForget(() => this.attachWebGL());
        }
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            return handleOsc52Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            return handleOsc16162Command(data, this.blockId, this.loaded, this);
        });
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    const tabId = globalStore.get(atoms.staticTabId);
                    setTabIndicator(tabId, { icon: "bell", color: "#fbbf24", clearonfocus: true, priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler(waveOptions.keydownHandler);
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(150, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    getZoneId(): string {
        return this.blockId;
    }

    resetCompositionState() {
        this.isComposing = false;
        this.composingData = "";
    }

    private handleCompositionStart = (e: CompositionEvent) => {
        dlog("compositionstart", e.data);
        this.isComposing = true;
        this.composingData = "";
    };

    private handleCompositionUpdate = (e: CompositionEvent) => {
        dlog("compositionupdate", e.data);
        this.composingData = e.data || "";
    };

    private handleCompositionEnd = (e: CompositionEvent) => {
        dlog("compositionend", e.data);
        this.isComposing = false;
        this.lastComposedText = e.data || "";
        this.lastCompositionEnd = Date.now();
        this.firstDataAfterCompositionSent = false;
    };

    async initTerminal() {
        const perfId = `terminal-init-${this.blockId}`;
        performance.mark(`${perfId}-start`);
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(this.terminal.onKey(this.onKeyHandler.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    const selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            await this.loadSearchAddon();
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        // Register IME composition event listeners on the xterm.js textarea
        const textareaElem = this.connectElem.querySelector("textarea");
        if (textareaElem) {
            textareaElem.addEventListener("compositionstart", this.handleCompositionStart);
            textareaElem.addEventListener("compositionupdate", this.handleCompositionUpdate);
            textareaElem.addEventListener("compositionend", this.handleCompositionEnd);

            // Handle blur during composition - reset state to avoid stale data
            const blurHandler = () => {
                if (this.isComposing) {
                    dlog("Terminal lost focus during composition, resetting IME state");
                    this.resetCompositionState();
                }
            };
            textareaElem.addEventListener("blur", blurHandler);

            this.toDispose.push({
                dispose: () => {
                    textareaElem.removeEventListener("compositionstart", this.handleCompositionStart);
                    textareaElem.removeEventListener("compositionupdate", this.handleCompositionUpdate);
                    textareaElem.removeEventListener("compositionend", this.handleCompositionEnd);
                    textareaElem.removeEventListener("blur", blurHandler);
                },
            });
        }

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        // Run RPC info fetch and terminal data load in parallel for faster startup
        const [rtInfo] = await Promise.all([
            RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            }).catch((e) => {
                console.log("Error loading runtime info:", e);
                return null;
            }),
            this.loadInitialTerminalData().finally(() => {
                this.loaded = true;
            }),
        ]);

        if (rtInfo && rtInfo["shell:integration"]) {
            const shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
            globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
        } else {
            globalStore.set(this.shellIntegrationStatusAtom, null);
        }
        const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
        globalStore.set(this.lastCommandAtom, lastCmd || null);
        performance.mark(`${perfId}-end`);
        performance.measure(`terminal-init-${this.blockId}`, `${perfId}-start`, `${perfId}-end`);
        const measure = performance.getEntriesByName(`terminal-init-${this.blockId}`, "measure")[0];
        if (measure) {
            dlog(`[perf] terminal init ${this.blockId}: ${measure.duration.toFixed(1)}ms`);
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        this.disposed = true;
        if (this.idleTimeoutId != null) {
            clearTimeout(this.idleTimeoutId);
            this.idleTimeoutId = null;
        }
        // Clear coalescing buffer to prevent orphaned microtask writes after dispose
        this._wsCoalesceBuffer = [];
        this._wsCoalesceScheduled = false;
        this.batchedWriter.dispose();
        this.detachWebGL();
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {}
        });
        this.promptMarkers = [];
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {}
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        // IME Composition Handling
        // Block all data during composition - only send the final text after compositionend
        // This prevents xterm.js from sending intermediate composition data (e.g., during compositionupdate)
        if (this.isComposing) {
            dlog("Blocked data during composition:", data);
            return;
        }

        if (this.pasteActive) {
            if (this.multiInputCallback) {
                this.multiInputCallback(data);
            }
        }

        // IME Deduplication (for Capslock input method switching)
        // Skip entirely if no composition has ever occurred (fast path for non-IME users)
        if (this.lastCompositionEnd > 0) {
            const IMEDedupWindowMs = 30;
            const now = Date.now();
            const timeSinceCompositionEnd = now - this.lastCompositionEnd;
            if (timeSinceCompositionEnd < IMEDedupWindowMs && data === this.lastComposedText && this.lastComposedText) {
                if (!this.firstDataAfterCompositionSent) {
                    this.firstDataAfterCompositionSent = true;
                    dlog("First data after composition, allowing:", data);
                } else {
                    dlog("Blocked duplicate IME data:", data);
                    this.lastComposedText = "";
                    this.firstDataAfterCompositionSent = false;
                    return;
                }
            }
        }

        this.sendDataHandler?.(data);
    }

    onKeyHandler(data: { key: string; domEvent: KeyboardEvent }) {
        if (this.multiInputCallback) {
            this.multiInputCallback(data.key);
        }
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    // Coalescing buffer for rapid WebSocket messages — merges multiple base64 chunks
    // into a single write per microtask instead of one write per message
    private _wsCoalesceBuffer: Uint8Array[] = [];
    private _wsCoalesceScheduled: boolean = false;

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.heldData = [];
            this._wsCoalesceBuffer = [];
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                // Coalesce: buffer decoded chunks and flush once per microtask
                this._wsCoalesceBuffer.push(decodedData);
                if (!this._wsCoalesceScheduled) {
                    this._wsCoalesceScheduled = true;
                    queueMicrotask(() => {
                        this._wsCoalesceScheduled = false;
                        const chunks = this._wsCoalesceBuffer;
                        this._wsCoalesceBuffer = [];
                        if (chunks.length === 1) {
                            this.doTerminalWrite(chunks[0], null);
                        } else if (chunks.length > 1) {
                            // Merge all chunks into one Uint8Array
                            let totalLen = 0;
                            for (const c of chunks) totalLen += c.length;
                            const merged = new Uint8Array(totalLen);
                            let offset = 0;
                            for (const c of chunks) {
                                merged.set(c, offset);
                                offset += c.length;
                            }
                            this.doTerminalWrite(merged, null);
                        }
                    });
                }
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        // Route through batched writer to coalesce high-throughput output
        this.batchedWriter.write(data);
        if (setPtyOffset != null) {
            this.ptyOffset = setPtyOffset;
        } else {
            this.ptyOffset += data.length;
            this.dataBytesProcessed += data.length;
        }
        this.lastUpdated = Date.now();
        return RESOLVED_PROMISE;
    }

    async loadInitialTerminalData(): Promise<void> {
        const loadPerfId = `terminal-load-${this.blockId}`;
        performance.mark(`${loadPerfId}-start`);
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("terminal restore size mismatch, temp resize", fileTermSize, curTermSize);
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log(`terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes`);
        performance.mark(`${loadPerfId}-end`);
        performance.measure(`terminal-load-${this.blockId}`, `${loadPerfId}-start`, `${loadPerfId}-end`);
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    // --- Lazy addon lifecycle methods ---

    async attachWebGL(): Promise<void> {
        if (this.webglAddon) return;
        // Skip WebGL when transparency is enabled — WebGL canvas is always opaque
        // and hides any background image/color set behind the terminal
        if (this.terminal.options.allowTransparency) {
            return;
        }
        try {
            const { WebglAddon } = await import("@xterm/addon-webgl");
            this.webglAddon = new WebglAddon();
            this.webglAddon.onContextLoss(() => {
                // On GPU context loss, dispose and null so next attach re-creates it
                this.webglAddon?.dispose();
                this.webglAddon = null;
                // Force a re-render to clear stale visuals from the lost context
                this.terminal.refresh(0, this.terminal.rows - 1);
            });
            this.terminal.loadAddon(this.webglAddon);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        } catch (e) {
            console.warn("WebGL attach failed, using canvas:", e);
            this.webglAddon = null;
        }
    }

    detachWebGL(): void {
        if (this.webglAddon) {
            this.webglAddon.dispose();
            this.webglAddon = null;
        }
    }

    async loadSearchAddon(): Promise<void> {
        if (this.searchAddon) return;
        const { SearchAddon } = await import("@xterm/addon-search");
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
    }

    async loadSerializeAddon(): Promise<void> {
        if (this.serializeAddon) return;
        const { SerializeAddon } = await import("@xterm/addon-serialize");
        this.serializeAddon = new SerializeAddon();
        this.terminal.loadAddon(this.serializeAddon);
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            // Skip resize RPC if terminal is actively receiving heavy output — the backend
            // will get the correct size on the next idle resize or controller resync
            if (Date.now() - this.lastUpdated > 500) {
                RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
            } else {
                dlog("resize RPC deferred — terminal active", this.blockId);
            }
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    processAndCacheData() {
        // Skip serialization if terminal is actively receiving data (< 2s since last write)
        // This prevents expensive serialize() calls from blocking the main thread during AI output floods
        const now = Date.now();
        if (now - this.lastUpdated < 2000) {
            dlog("skipping cache — terminal still active", this.blockId);
            return;
        }
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const bytesToCache = this.dataBytesProcessed;
        this.dataBytesProcessed = 0;
        fireAndForget(async () => {
            await this.loadSerializeAddon();
            const serializedOutput = this.serializeAddon.serialize();
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            dlog("cache term", bytesToCache, "processed →", serializedOutput.length, "serialized", termSize);
            await services.BlockService.SaveTerminalState(
                this.blockId,
                serializedOutput,
                "full",
                this.ptyOffset,
                termSize
            );
        });
    }

    runProcessIdleTimeout() {
        // Use longer interval when heavy output is being processed to reduce serialization pressure
        const interval = this.dataBytesProcessed > MinDataProcessedForCache ? 15000 : 5000;
        this.idleTimeoutId = setTimeout(() => {
            if (this.disposed) return;
            window.requestIdleCallback(() => {
                if (this.disposed) return;
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, interval);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }
}
