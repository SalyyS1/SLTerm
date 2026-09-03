// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { HostRouteId } from "@/app/store/wshrpcutil-base";
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
import { reconcileHeldData, waveFileDataStartIdx, type HeldChunk } from "./term-replay";
import { BatchedWriter } from "./term-batched-writer";
import { canMeasureTermLayout } from "./term-spawn-gate";
import { parkCarriedTerminal, takeCarriedTerminal } from "./term-carry-over";
import { createTempFileFromBlob, extractAllClipboardData } from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
// Cap on output held while the initial replay is in flight. The window is two
// loopback reads long, so this is only ever hit by a firehose; passing it drops
// to a clean refetch rather than replaying a partial stream.
const MaxHeldDataBytes = 1024 * 1024;
// How many times to refetch when held output cannot be reconciled against the
// read. One pass is enough unless output keeps overflowing the hold buffer.
const MaxReplayRefetches = 3;
// How long to wait for a layout before starting the shell anyway. A block that is
// mounted but never laid out (hidden container, zero-size parent) would otherwise
// never run its command at all.
const SpawnFallbackTimeoutMs = 1000;
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

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    /**
     * The offset xterm has finished parsing, as opposed to the offset handed to it.
     * xterm's write is asynchronous, so a snapshot taken right after a write does not
     * contain that write. Parking a snapshot with the optimistic offset would leave
     * the bytes in between on neither the old screen nor the new one.
     */
    private renderedPtyOffset: number;
    /** Post-write absolute offsets, one per queued chunk, consumed as xterm parses them. */
    private pendingOffsetMarks: number[];
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
    heldData: HeldChunk[];
    heldDataBytes: number;
    /** Set when held output was dropped and can no longer be replayed in full. */
    heldDataUnusable: boolean;
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

    // Spawn gating: the shell is started by the first resize, so that resize has to
    // carry a real measurement. A block that never gets a layout still has to run,
    // hence the fallback timer.
    private spawnFallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
        this.renderedPtyOffset = 0;
        this.pendingOffsetMarks = [];
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
        this.batchedWriter = new BatchedWriter(this.terminal, this.handleWriteParsed);
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
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: HostRouteId }));
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
        this.heldDataBytes = 0;
        this.heldDataUnusable = false;
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
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
            this.replayInitialData(),
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
        // Loaded up front rather than on the first idle save, because it is also what
        // lets the screen be parked for a remount — and a remount can happen before
        // enough output has flowed to trigger a save.
        fireAndForget(this.loadSerializeAddon.bind(this));
        this.runProcessIdleTimeout();
    }

    dispose() {
        this.disposed = true;
        if (this.idleTimeoutId != null) {
            clearTimeout(this.idleTimeoutId);
            this.idleTimeoutId = null;
        }
        if (this.spawnFallbackTimeoutId != null) {
            clearTimeout(this.spawnFallbackTimeoutId);
            this.spawnFallbackTimeoutId = null;
        }
        // Park the screen for whatever instance replaces this one. A move or swap in
        // the layout tree, and any option xterm can only take at construction, tear
        // this instance down and build another against the same block.
        this.parkScreenForRemount();
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

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.resetHeldData();
            // The file restarts at zero, so a stale offset would make the next
            // reload read past the end and restore nothing.
            this.resetWriteTracking(0);
            this.dataBytesProcessed = 0;
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                this.doTerminalWrite(decodedData, null);
            } else {
                this.holdData(msg.offset, decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    private resetHeldData() {
        this.heldData = [];
        this.heldDataBytes = 0;
        this.heldDataUnusable = false;
    }

    /**
     * Parks live output until the initial replay has finished writing.
     *
     * Nothing is written out of order and nothing is silently dropped: on
     * overflow the buffer is discarded and flagged, which sends the caller to a
     * full refetch instead of replaying a stream with a hole in it.
     */
    private holdData(offset: number | undefined, data: Uint8Array) {
        if (offset == null) {
            this.heldDataUnusable = true;
            return;
        }
        if (this.heldDataBytes + data.length > MaxHeldDataBytes) {
            this.heldData = [];
            this.heldDataBytes = 0;
            this.heldDataUnusable = true;
            return;
        }
        this.heldData.push({ offset, data });
        this.heldDataBytes += data.length;
    }

    /**
     * Applies the output held during the initial replay, and reports whether it
     * could be applied in full.
     */
    private drainHeldData(): boolean {
        const held = this.heldData;
        const unusable = this.heldDataUnusable;
        this.heldData = [];
        this.heldDataBytes = 0;
        this.heldDataUnusable = false;
        if (unusable) {
            return false;
        }
        const { writes, ok } = reconcileHeldData(held, this.ptyOffset);
        if (!ok) {
            return false;
        }
        for (const write of writes) {
            this.doTerminalWrite(write, null);
        }
        return true;
    }

    /**
     * Puts the terminal on screen, then opens the gate to live output.
     *
     * The stream is subscribed before this runs, so appends that land while the
     * read is in flight are held and then applied by offset once the read is on
     * screen. Dropping them instead — which is what an undrained hold buffer
     * does — can cut an escape sequence in half, and a half-parsed sequence is
     * what turns Claude's in-place redraws into screenfuls of duplicate lines.
     */
    private async replayInitialData(): Promise<void> {
        try {
            await this.loadInitialTerminalData();
            for (let refetch = 0; !this.drainHeldData(); refetch++) {
                if (refetch >= MaxReplayRefetches) {
                    console.log("terminal replay did not converge, continuing from the last read", this.blockId);
                    break;
                }
                await this.reloadFromFile();
            }
        } catch (e) {
            // Held output is worthless without the history it continues, and
            // keeping it would pin its bytes for the life of the block.
            console.log("error replaying terminal history", this.blockId, e);
            this.resetHeldData();
        } finally {
            // Live output must flow even if the replay failed; a terminal that
            // shows nothing is worse than one that starts mid-stream.
            this.loaded = true;
        }
    }

    /** Rereads the whole term file, which is authoritative, over a clean grid. */
    private async reloadFromFile(): Promise<void> {
        this.resetHeldData();
        this.terminal.reset();
        this.resetWriteTracking(0);
        const { data, fileInfo } = await fetchWaveFile(this.getZoneId(), TermFileName, 0);
        if (fileInfo == null) {
            return;
        }
        this.doTerminalWrite(data, fileInfo.size);
        this.dataBytesProcessed += data?.length ?? 0;
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
        // One mark per queued chunk, matching what the writer counts, so the parse
        // callback can say which offset is now actually on the screen.
        this.pendingOffsetMarks.push(this.ptyOffset);
        this.lastUpdated = Date.now();
        return RESOLVED_PROMISE;
    }

    /** Advances the rendered offset as xterm finishes parsing each batch. */
    private handleWriteParsed = (chunkCount: number) => {
        if (chunkCount <= 0 || this.pendingOffsetMarks.length === 0) {
            return;
        }
        const taken = Math.min(chunkCount, this.pendingOffsetMarks.length);
        this.renderedPtyOffset = this.pendingOffsetMarks[taken - 1];
        this.pendingOffsetMarks.splice(0, taken);
    };

    /** Forgets write bookkeeping after the grid has been thrown away. */
    private resetWriteTracking(offset: number) {
        this.ptyOffset = offset;
        this.renderedPtyOffset = offset;
        this.pendingOffsetMarks = [];
    }

    async loadInitialTerminalData(): Promise<void> {
        const loadPerfId = `terminal-load-${this.blockId}`;
        performance.mark(`${loadPerfId}-start`);
        const zoneId = this.getZoneId();
        // A screen parked by the instance this one replaces is both cheaper and more
        // complete than the cache file: it is already in memory, and it holds lines
        // the term file's circular window may have dropped.
        let ptyOffset = this.restoreFromCarryOver();
        if (ptyOffset == null) {
            ptyOffset = await this.restoreFromCacheFile(zoneId);
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log(`terminal loaded main:${mainData?.byteLength ?? 0} bytes from offset ${ptyOffset}`);
        performance.mark(`${loadPerfId}-end`);
        performance.measure(`terminal-load-${this.blockId}`, `${loadPerfId}-start`, `${loadPerfId}-end`);
        if (mainFile != null) {
            // The server serves from its earliest retained byte when the asked-for
            // offset has already scrolled out of the circular file. Appending a
            // stream that starts later than the snapshot ended would splice two
            // unrelated points together, so drop the snapshot and start clean.
            if (waveFileDataStartIdx(mainFile) > ptyOffset) {
                console.log("terminal history wrapped past the cached offset, restoring without the snapshot");
                this.terminal.reset();
                this.resetWriteTracking(ptyOffset);
            }
            // Take the offset from the file rather than the byte count: they differ
            // by exactly the bytes a wrap dropped, and the offset is what every
            // later read and every held append is measured against.
            this.doTerminalWrite(mainData, mainFile.size);
            this.dataBytesProcessed += mainData?.length ?? 0;
        }
    }

    /**
     * Writes a snapshot that was serialized at a possibly different geometry.
     *
     * xterm reflows on resize, so a snapshot taken at another width has to be written
     * at *its* width and the terminal put back afterwards — otherwise the restored
     * lines wrap differently than they did when they were produced.
     */
    private writeSnapshotAtSize(snapshot: string | Uint8Array, snapshotSize: TermSize | null, ptyOffset: number) {
        const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        const needsResize =
            snapshotSize != null &&
            (snapshotSize.rows !== curTermSize.rows || snapshotSize.cols !== curTermSize.cols);
        if (needsResize) {
            this.terminal.resize(snapshotSize.cols, snapshotSize.rows);
        }
        this.doTerminalWrite(snapshot, ptyOffset);
        if (needsResize) {
            this.terminal.resize(curTermSize.cols, curTermSize.rows);
        }
    }

    /** Restores a screen parked by the outgoing instance; null when there is none. */
    private restoreFromCarryOver(): number | null {
        const carried = takeCarriedTerminal(this.blockId);
        if (carried == null) {
            return null;
        }
        dlog("restoring carried screen", this.blockId, carried.snapshot.length, carried.ptyOffset);
        if (carried.snapshot.length > 0) {
            this.writeSnapshotAtSize(carried.snapshot, carried.termSize, carried.ptyOffset);
        } else {
            this.resetWriteTracking(carried.ptyOffset);
        }
        return carried.ptyOffset;
    }

    /**
     * Parks the current screen so the instance replacing this one can restore it
     * instead of re-reading the whole term file.
     *
     * The offset parked is the one xterm has *parsed*, not the one it was handed:
     * bytes still in its write queue are not in the snapshot, and claiming they were
     * would drop them from the screen entirely. The replacement reads on from the
     * parsed offset, so anything in flight is simply read again.
     */
    private parkScreenForRemount() {
        if (this.serializeAddon == null) {
            // Nothing loaded to serialize with; the file replay still restores the
            // block, so this is a missed optimisation rather than lost output.
            return;
        }
        try {
            const snapshot = this.serializeAddon.serialize();
            parkCarriedTerminal(this.blockId, {
                snapshot,
                ptyOffset: this.renderedPtyOffset,
                termSize: { rows: this.terminal.rows, cols: this.terminal.cols },
            });
        } catch (e) {
            dlog("could not park terminal screen", this.blockId, e);
        }
    }

    /** Restores the periodically-saved snapshot from the block's cache file. */
    private async restoreFromCacheFile(zoneId: string): Promise<number> {
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        if (cacheFile == null) {
            return 0;
        }
        const ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
        if (cacheData.byteLength > 0) {
            this.writeSnapshotAtSize(cacheData, cacheFile.meta["termsize"] ?? null, ptyOffset);
        }
        return ptyOffset;
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
        // Transparency is deliberately not a reason to skip WebGL. @xterm/addon-webgl
        // 0.19 honours allowTransparency: it only forces colors opaque when the option
        // is off, creates its char atlas with an alpha channel when it is on, and
        // enables SRC_ALPHA blending without clearing to an opaque color. The renderer
        // and the background are independent, and every background this app draws sits
        // behind the terminal, so tying them together cost every themed window the
        // fast renderer for nothing.
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

    /**
     * Whether the connected element currently has a layout xterm can measure.
     * See {@link canMeasureTermLayout} for why an empty box has to disqualify the
     * measurement even when the fit addon proposes numbers.
     */
    private canMeasureLayout(): boolean {
        return canMeasureTermLayout(
            this.connectElem.clientWidth,
            this.connectElem.clientHeight,
            this.fitAddon.proposeDimensions()
        );
    }

    /** Starts the shell with whatever size is known, if a real measurement never arrives. */
    private armSpawnFallback() {
        if (this.spawnFallbackTimeoutId != null || this.hasResized || this.disposed) {
            return;
        }
        this.spawnFallbackTimeoutId = setTimeout(() => {
            this.spawnFallbackTimeoutId = null;
            if (this.hasResized || this.disposed) {
                return;
            }
            dlog("spawn fallback: no layout to measure, starting at", `${this.terminal.rows}x${this.terminal.cols}`);
            this.hasResized = true;
            this.resyncController("spawn fallback");
        }, SpawnFallbackTimeoutMs);
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        // Fitting against an unlaid-out element leaves the terminal at xterm's
        // construction default, and starting the shell at that size makes it paint
        // its first frame at the wrong width — the redraw that produces ghost
        // characters after a clear. Wait for a size that means something instead.
        const measurable = this.canMeasureLayout();
        if (measurable) {
            this.fitAddon.fit();
        }
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (this.hasResized) {
            return;
        }
        if (!measurable) {
            this.armSpawnFallback();
            return;
        }
        if (this.spawnFallbackTimeoutId != null) {
            clearTimeout(this.spawnFallbackTimeoutId);
            this.spawnFallbackTimeoutId = null;
        }
        this.hasResized = true;
        this.resyncController("initial resize");
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        fireAndForget(async () => {
            await this.loadSerializeAddon();
            const serializedOutput = this.serializeAddon.serialize();
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
            await services.BlockService.SaveTerminalState(
                this.blockId,
                serializedOutput,
                "full",
                this.ptyOffset,
                termSize
            );
        });
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        this.idleTimeoutId = setTimeout(() => {
            if (this.disposed) return;
            window.requestIdleCallback(() => {
                if (this.disposed) return;
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
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
