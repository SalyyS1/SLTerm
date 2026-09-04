// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getFocusedBlockId,
    getSettingsKeyAtom,
    globalStore,
    recordTEvent,
    refocusNode,
    replaceBlock,
    setActiveTab,
    WOS,
} from "@/app/store/global";
import { type CommandDef, defaultBindings, registerCommand, runCommand } from "@/app/store/commands";
import { getActiveTabModel } from "@/app/store/tab-model";

import { deleteLayoutModelForTab, getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

const simpleControlShiftAtom = jotai.atom(false);
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();
const globalChordMap = new Map<string, Map<string, KeyHandler>>();
let globalKeybindingsDisabled = false;

// track current chord state and timeout (for resetting)
let activeChord: string | null = null;
let chordTimeout: NodeJS.Timeout = null;

function resetChord() {
    activeChord = null;
    if (chordTimeout) {
        clearTimeout(chordTimeout);
        chordTimeout = null;
    }
}

function setActiveChord(activeChordArg: string) {
    getApi().setKeyboardChordMode();
    if (chordTimeout) {
        clearTimeout(chordTimeout);
    }
    activeChord = activeChordArg;
    chordTimeout = setTimeout(() => resetChord(), CHORD_TIMEOUT);
}

export function keyboardMouseDownHandler(e: MouseEvent) {
    if (!e.ctrlKey || !e.shiftKey) {
        unsetControlShift();
    }
}

function getFocusedBlockInStaticTab() {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    return focusedNode.data?.blockId;
}

function getSimpleControlShiftAtom() {
    return simpleControlShiftAtom;
}

function setControlShift() {
    globalStore.set(simpleControlShiftAtom, true);
    const disableDisplay = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftdisplay"));
    if (!disableDisplay) {
        setTimeout(() => {
            const simpleState = globalStore.get(simpleControlShiftAtom);
            if (simpleState) {
                globalStore.set(atoms.controlShiftDelayAtom, true);
            }
        }, 400);
    }
}

function unsetControlShift() {
    globalStore.set(simpleControlShiftAtom, false);
    globalStore.set(atoms.controlShiftDelayAtom, false);
}

function disableGlobalKeybindings() {
    globalKeybindingsDisabled = true;
}

function enableGlobalKeybindings() {
    globalKeybindingsDisabled = false;
}

function shouldDispatchToBlock(e: WaveKeyboardEvent): boolean {
    if (globalStore.get(atoms.modalOpen)) {
        return false;
    }
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem instanceof HTMLElement) {
        if (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA" || activeElem.contentEditable == "true") {
            if (activeElem.classList.contains("dummy-focus") || activeElem.classList.contains("dummy")) {
                return true;
            }
            if (keyutil.isInputEvent(e)) {
                return false;
            }
            return true;
        }
    }
    return true;
}

function getStaticTabBlockCount(): number {
    const tabId = globalStore.get(atoms.staticTabId);
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    return tabData?.blockids?.length ?? 0;
}

function simpleCloseStaticTab() {
    const ws = globalStore.get(atoms.workspace);
    const tabId = globalStore.get(atoms.staticTabId);
    getApi().closeTab(ws.oid, tabId);
    deleteLayoutModelForTab(tabId);
}

function uxCloseBlock(blockId: string) {
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);

    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel.getNodeByBlockId(blockId);
    if (node) {
        fireAndForget(() => layoutModel.closeNode(node.id));
    }
}

function genericClose() {
    const blockCount = getStaticTabBlockCount();
    if (blockCount === 0) {
        simpleCloseStaticTab();
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    fireAndForget(layoutModel.closeFocusedNode.bind(layoutModel));
}

function switchBlockByBlockNum(index: number) {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }
    layoutModel.switchNodeFocusByBlockNum(index);
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function switchBlockInDirection(direction: NavigateDirection) {
    const layoutModel = getLayoutModelForStaticTab();
    layoutModel.switchNodeFocusInDirection(direction, false);
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function getAllTabs(ws: Workspace): string[] {
    return ws.tabids ?? [];
}

function switchTabAbs(index: number) {
    console.log("switchTabAbs", index);
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    const tabids = getAllTabs(ws);
    if (newTabIdx < 0 || newTabIdx >= tabids.length) {
        return;
    }
    const newActiveTabId = tabids[newTabIdx];
    setActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    console.log("switchTab", offset);
    const ws = globalStore.get(atoms.workspace);
    const curTabId = globalStore.get(atoms.staticTabId);
    let tabIdx = -1;
    const tabids = getAllTabs(ws);
    for (let i = 0; i < tabids.length; i++) {
        if (tabids[i] == curTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + tabids.length) % tabids.length;
    const newActiveTabId = tabids[newTabIdx];
    setActiveTab(newActiveTabId);
}

function handleCmdI() {
    globalRefocus();
}

function globalRefocusWithTimeout(timeoutVal: number) {
    setTimeout(() => {
        globalRefocus();
    }, timeoutVal);
}

function globalRefocus() {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        // focus a node
        layoutModel.focusFirstNode();
        return;
    }
    const blockId = focusedNode?.data?.blockId;
    if (blockId == null) {
        return;
    }
    refocusNode(blockId);
}

function getDefaultNewBlockDef(): BlockDef {
    const adnbAtom = getSettingsKeyAtom("app:defaultnewblock");
    const adnb = globalStore.get(adnbAtom) ?? "term";
    if (adnb == "launcher") {
        return {
            meta: {
                view: "launcher",
            },
        };
    }
    // "term", blank, anything else, fall back to terminal
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedNode.data?.blockId));
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view == "term") {
            if (blockData?.meta?.["cmd:cwd"] != null) {
                termBlockDef.meta["cmd:cwd"] = blockData.meta["cmd:cwd"];
            }
        }
        if (blockData?.meta?.connection != null) {
            termBlockDef.meta.connection = blockData.meta.connection;
        }
    }
    return termBlockDef;
}

async function handleCmdN() {
    const blockDef = getDefaultNewBlockDef();
    await createBlock(blockDef);
}

async function handleSplitHorizontal(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitHorizontally(blockDef, focusedNode.data.blockId, position);
}

async function handleSplitVertical(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitVertically(blockDef, focusedNode.data.blockId, position);
}

let lastHandledEvent: KeyboardEvent | null = null;

// returns [keymatch, T]
function checkKeyMap<T>(waveEvent: WaveKeyboardEvent, keyMap: Map<string, T>): [string, T] {
    for (const key of keyMap.keys()) {
        if (keyutil.checkKeyPressed(waveEvent, key)) {
            const val = keyMap.get(key);
            return [key, val];
        }
    }
    return [null, null];
}

function appHandleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
    if (globalKeybindingsDisabled) {
        return false;
    }
    const nativeEvent = (waveEvent as any).nativeEvent;
    if (lastHandledEvent != null && nativeEvent != null && lastHandledEvent === nativeEvent) {
        console.log("lastHandledEvent return false");
        return false;
    }
    lastHandledEvent = nativeEvent;
    if (activeChord) {
        console.log("handle activeChord", activeChord);
        // If we're in chord mode, look for the second key.
        const chordBindings = globalChordMap.get(activeChord);
        const [, handler] = checkKeyMap(waveEvent, chordBindings);
        if (handler) {
            resetChord();
            return handler(waveEvent);
        } else {
            // invalid chord; reset state and consume key
            resetChord();
            return true;
        }
    }
    const [chordKeyMatch] = checkKeyMap(waveEvent, globalChordMap);
    if (chordKeyMatch) {
        setActiveChord(chordKeyMatch);
        return true;
    }

    const [, globalHandler] = checkKeyMap(waveEvent, globalKeyMap);
    if (globalHandler) {
        const handled = globalHandler(waveEvent);
        if (handled) {
            return true;
        }
    }
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const blockId = focusedNode?.data?.blockId;
    if (blockId != null && shouldDispatchToBlock(waveEvent)) {
        const bcm = getBlockComponentModel(blockId);
        const viewModel = bcm?.viewModel;
        if (viewModel?.keyDownHandler) {
            const handledByBlock = viewModel.keyDownHandler(waveEvent);
            if (handledByBlock) {
                return true;
            }
        }
    }
    return false;
}

function registerControlShiftStateUpdateHandler() {
    getApi().onControlShiftStateUpdate((state: boolean) => {
        if (state) {
            setControlShift();
        } else {
            unsetControlShift();
        }
    });
}

function registerElectronReinjectKeyHandler() {
    getApi().onReinjectKey((event: WaveKeyboardEvent) => {
        appHandleKeyDown(event);
    });
}

function tryReinjectKey(event: WaveKeyboardEvent): boolean {
    return appHandleKeyDown(event);
}

function countTermBlocks(): number {
    const allBCMs = getAllBlockComponentModels();
    let count = 0;
    let gsGetBound = globalStore.get.bind(globalStore);
    for (const bcm of allBCMs) {
        const viewModel = bcm.viewModel;
        if (viewModel.viewType == "term" && viewModel.isBasicTerm?.(gsGetBound)) {
            count++;
        }
    }
    return count;
}

function registerGlobalKeys() {
    // Every global action is registered as a command with an id and a label,
    // then bound to its default chord below. The indirection is what lets the
    // application menu, the command palette and user keybindings all reach the
    // same action instead of each restating it — and it makes an unregistered
    // action detectable, which is what keeps those ports honest.
    const commands: CommandDef[] = [
        {
            id: "tab:next",
            label: "Next Tab",
            group: "Tabs",
            defaultBinding: "Cmd:]",
            handler: () => {
                switchTab(1);
                return true;
            },
        },
        {
            id: "tab:prev",
            label: "Previous Tab",
            group: "Tabs",
            defaultBinding: "Cmd:[",
            handler: () => {
                switchTab(-1);
                return true;
            },
        },
        {
            id: "tab:new",
            label: "New Tab",
            group: "Tabs",
            defaultBinding: "Cmd:t",
            handler: () => {
                createTab();
                return true;
            },
        },
        {
            id: "tab:close",
            label: "Close Tab",
            group: "Tabs",
            defaultBinding: "Cmd:Shift:w",
            handler: () => {
                simpleCloseStaticTab();
                return true;
            },
        },
        {
            id: "block:new",
            label: "New Block",
            group: "Blocks",
            defaultBinding: "Cmd:n",
            handler: () => {
                handleCmdN();
                return true;
            },
        },
        {
            id: "block:splitRight",
            label: "Split Right",
            group: "Blocks",
            defaultBinding: "Cmd:d",
            handler: () => {
                handleSplitHorizontal("after");
                return true;
            },
        },
        {
            id: "block:splitDown",
            label: "Split Down",
            group: "Blocks",
            defaultBinding: "Shift:Cmd:d",
            handler: () => {
                handleSplitVertical("after");
                return true;
            },
        },
        {
            id: "block:info",
            label: "Toggle Block Info",
            group: "Blocks",
            defaultBinding: "Cmd:i",
            handler: () => {
                handleCmdI();
                return true;
            },
        },
        {
            id: "block:close",
            label: "Close Block",
            group: "Blocks",
            defaultBinding: "Cmd:w",
            handler: () => {
                genericClose();
                return true;
            },
        },
        {
            id: "block:magnify",
            label: "Magnify Block",
            group: "Blocks",
            defaultBinding: "Cmd:m",
            handler: () => {
                const layoutModel = getLayoutModelForStaticTab();
                const focusedNode = globalStore.get(layoutModel.focusedNode);
                if (focusedNode != null) {
                    layoutModel.magnifyNodeToggle(focusedNode.id);
                }
                return true;
            },
        },
        {
            id: "block:launcher",
            label: "Open Widget Launcher",
            group: "Blocks",
            defaultBinding: "Ctrl:Shift:k",
            handler: () => {
                const blockId = getFocusedBlockId();
                if (blockId == null) {
                    return true;
                }
                replaceBlock(
                    blockId,
                    {
                        meta: {
                            view: "launcher",
                        },
                    },
                    true
                );
                return true;
            },
        },
        {
            id: "block:switchConnection",
            label: "Switch Connection",
            group: "Blocks",
            defaultBinding: "Cmd:g",
            handler: () => {
                const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
                if (bcm.openSwitchConnection != null) {
                    recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
                    bcm.openSwitchConnection();
                    return true;
                }
                return false;
            },
        },
        {
            id: "term:multiInput",
            label: "Toggle Multi-Input",
            group: "Terminal",
            defaultBinding: "Ctrl:Shift:i",
            handler: () => {
                const tabModel = getActiveTabModel();
                if (tabModel == null) {
                    return true;
                }
                const curMI = globalStore.get(tabModel.isTermMultiInput);
                if (!curMI && countTermBlocks() <= 1) {
                    // don't turn on multi-input unless there are 2 or more basic term blocks
                    return true;
                }
                globalStore.set(tabModel.isTermMultiInput, !curMI);
                return true;
            },
        },
        {
            id: "block:search",
            label: "Find in Block",
            group: "Blocks",
            defaultBinding: "Cmd:f",
            handler: (event) => activateSearch(event),
        },
        {
            id: "app:escape",
            label: "Dismiss",
            group: "App",
            defaultBinding: "Escape",
            handler: () => {
                if (modalsModel.hasOpenModals()) {
                    modalsModel.popModal();
                    return true;
                }
                if (deactivateSearch()) {
                    return true;
                }
                return false;
            },
        },
    ];

    // Directional block navigation. One setting gates all four, so they share a
    // handler factory rather than repeating the check.
    const directions: Array<[string, string, NavigateDirection]> = [
        ["up", "ArrowUp", NavigateDirection.Up],
        ["down", "ArrowDown", NavigateDirection.Down],
        ["left", "ArrowLeft", NavigateDirection.Left],
        ["right", "ArrowRight", NavigateDirection.Right],
    ];
    for (const [name, key, direction] of directions) {
        commands.push({
            id: `block:focus${name[0].toUpperCase()}${name.slice(1)}`,
            label: `Focus Block ${name[0].toUpperCase()}${name.slice(1)}`,
            group: "Blocks",
            defaultBinding: `Ctrl:Shift:${key}`,
            handler: () => {
                const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
                if (disableCtrlShiftArrows) {
                    return false;
                }
                switchBlockInDirection(direction);
                return true;
            },
        });
    }

    for (let idx = 1; idx <= 9; idx++) {
        commands.push({
            id: `tab:switch${idx}`,
            label: `Switch to Tab ${idx}`,
            group: "Tabs",
            defaultBinding: `Cmd:${idx}`,
            handler: () => {
                switchTabAbs(idx);
                return true;
            },
        });
        commands.push({
            id: `block:switch${idx}`,
            label: `Switch to Block ${idx}`,
            group: "Blocks",
            defaultBinding: `Ctrl:Shift:c{Digit${idx}}`,
            handler: () => {
                switchBlockByBlockNum(idx);
                return true;
            },
        });
    }

    function activateSearch(event: WaveKeyboardEvent): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        // Ctrl+f is reserved in most shells
        if (event?.control && bcm.viewModel.viewType == "term") {
            return false;
        }
        if (bcm.viewModel.searchAtoms) {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, true);
            return true;
        }
        return false;
    }
    function deactivateSearch(): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.viewModel.searchAtoms && globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, false);
            return true;
        }
        return false;
    }

    for (const command of commands) {
        registerCommand(command);
    }

    // The keymap is derived from the registry, so a command is bound because it
    // was registered — there is no second list to keep in step. The numpad
    // variants are aliases for their Digit bindings rather than commands of
    // their own; a palette listing both would be noise.
    for (const [binding, id] of defaultBindings()) {
        globalKeyMap.set(binding, (event) => runCommand(id, event));
    }
    for (let idx = 1; idx <= 9; idx++) {
        globalKeyMap.set(`Ctrl:Shift:c{Numpad${idx}}`, (event) => runCommand(`block:switch${idx}`, event));
    }

    const allKeys = Array.from(globalKeyMap.keys());
    // special case keys, handled by web view
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft", "Cmd:o");
    getApi().registerGlobalWebviewKeys(allKeys);

    const splitBlockKeys = new Map<string, KeyHandler>();
    splitBlockKeys.set("ArrowUp", () => {
        handleSplitVertical("before");
        return true;
    });
    splitBlockKeys.set("ArrowDown", () => {
        handleSplitVertical("after");
        return true;
    });
    splitBlockKeys.set("ArrowLeft", () => {
        handleSplitHorizontal("before");
        return true;
    });
    splitBlockKeys.set("ArrowRight", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalChordMap.set("Ctrl:Shift:s", splitBlockKeys);
}

function getAllGlobalKeyBindings(): string[] {
    const allKeys = Array.from(globalKeyMap.keys());
    return allKeys;
}

export {
    appHandleKeyDown,
    disableGlobalKeybindings,
    enableGlobalKeybindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    tryReinjectKey,
    unsetControlShift,
    uxCloseBlock,
};
