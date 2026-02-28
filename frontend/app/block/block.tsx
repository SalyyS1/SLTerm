// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import {
    BlockComponentModel2,
    BlockNodeModel,
    BlockProps,
    FullBlockProps,
    FullSubBlockProps,
    SubBlockProps,
} from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { useTabModel } from "@/app/store/tab-model";
import { PreviewModel } from "@/app/view/preview/preview-model";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { useDebouncedNodeInnerRect } from "@/layout/index";
import {
    counterInc,
    getBlockComponentModel,
    registerBlockComponentModel,
    unregisterBlockComponentModel,
} from "@/store/global";
import { getWaveObjectAtom, makeORef, useWaveObjectValue } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank, useAtomValueSafe } from "@/util/util";
import { TermViewModel } from "@/view/term/term-model";
import { WebViewModel } from "@/view/webview/webview";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./block.scss";
import { BlockFrame } from "./blockframe";
import { blockViewToIcon, blockViewToName } from "./blockutil";

// Core views — eagerly loaded (always needed)
const EagerRegistry: Map<string, ViewModelClass> = new Map();
EagerRegistry.set("term", TermViewModel);
EagerRegistry.set("preview", PreviewModel);
EagerRegistry.set("web", WebViewModel);

// Heavy/rare views — lazily loaded on first use
type LazyViewModelLoader = () => Promise<ViewModelClass>;
const LazyRegistry: Map<string, LazyViewModelLoader> = new Map();
const lazyCtorCache: Map<string, ViewModelClass> = new Map();

LazyRegistry.set("cpuplot", () => import("@/app/view/sysinfo/sysinfo").then((m) => m.SysinfoViewModel));
LazyRegistry.set("sysinfo", () => import("@/app/view/sysinfo/sysinfo").then((m) => m.SysinfoViewModel));
LazyRegistry.set("vdom", () => import("@/app/view/vdom/vdom-model").then((m) => m.VDomModel));
LazyRegistry.set("tips", () => import("../view/quicktipsview/quicktipsview").then((m) => m.QuickTipsViewModel));
LazyRegistry.set("help", () => import("@/view/helpview/helpview").then((m) => m.HelpViewModel));
LazyRegistry.set("launcher", () => import("@/app/view/launcher/launcher").then((m) => m.LauncherViewModel));
LazyRegistry.set("tsunami", () => import("@/app/view/tsunami/tsunami").then((m) => m.TsunamiViewModel));
LazyRegistry.set("waveconfig", () => import("../view/waveconfig/waveconfig-model").then((m) => m.WaveConfigViewModel));

function makeViewModel(blockId: string, blockView: string, nodeModel: BlockNodeModel, tabModel: TabModel): ViewModel {
    const eagerCtor = EagerRegistry.get(blockView);
    if (eagerCtor != null) {
        return new eagerCtor(blockId, nodeModel, tabModel);
    }
    // Check if lazy ctor was already loaded
    const cachedCtor = lazyCtorCache.get(blockView);
    if (cachedCtor != null) {
        return new cachedCtor(blockId, nodeModel, tabModel);
    }
    return makeDefaultViewModel(blockId, blockView);
}

async function makeViewModelAsync(
    blockId: string,
    blockView: string,
    nodeModel: BlockNodeModel,
    tabModel: TabModel
): Promise<ViewModel> {
    const eagerCtor = EagerRegistry.get(blockView);
    if (eagerCtor != null) {
        return new eagerCtor(blockId, nodeModel, tabModel);
    }
    const lazyLoader = LazyRegistry.get(blockView);
    if (lazyLoader != null) {
        let ctor = lazyCtorCache.get(blockView);
        if (ctor == null) {
            ctor = await lazyLoader();
            lazyCtorCache.set(blockView, ctor);
        }
        return new ctor(blockId, nodeModel, tabModel);
    }
    return makeDefaultViewModel(blockId, blockView);
}

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): React.ReactElement {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (viewModel.viewComponent == null) {
        return <CenteredDiv>No View Component</CenteredDiv>;
    }
    const VC = viewModel.viewComponent;
    return <VC key={blockId} blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={viewModel} />;
}

function makeDefaultViewModel(blockId: string, viewType: string): ViewModel {
    const blockDataAtom = getWaveObjectAtom<Block>(makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.meta?.view);
        }),
        viewName: atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.meta?.view);
        }),
        preIconButton: atom(null),
        endIconButtons: atom(null),
        viewComponent: null,
    };
    return viewModel;
}

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const [blockData] = useWaveObjectValue<Block>(makeORef("block", nodeModel.blockId));
    if (!blockData) {
        return null;
    }
    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockSubBlock = memo(({ nodeModel, viewModel }: FullSubBlockProps) => {
    const [blockData] = useWaveObjectValue<Block>(makeORef("block", nodeModel.blockId));
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
    );
    const noPadding = useAtomValueSafe(viewModel.noPadding);
    if (!blockData) {
        return null;
    }
    return (
        <div key="content" className={clsx("block-content", { "block-no-padding": noPadding })} ref={contentRef}>
            <ErrorBoundary>
                <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
            </ErrorBoundary>
        </div>
    );
});

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const [blockData] = useWaveObjectValue<Block>(makeORef("block", nodeModel.blockId));
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const innerRect = useDebouncedNodeInnerRect(nodeModel);
    const noPadding = useAtomValueSafe(viewModel.noPadding);

    useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = focusedBlockId() == nodeModel.blockId;
        if (!focusWithin) {
            setFocusTarget();
        }
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [blockClicked, isFocused]);

    const setBlockClickedTrue = useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = useState<Dimensions>();

    useEffect(() => {
        if (blockRef.current && contentRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            setBlockContentOffset({
                top: 0,
                left: 0,
                width: blockRect.width - contentRect.width,
                height: blockRect.height - contentRect.height,
            });
        }
    }, [blockRef, contentRef]);

    const blockContentStyle = useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockData?.meta?.view, viewModel),
        [nodeModel.blockId, blockData?.meta?.view, viewModel]
    );

    const handleChildFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = useCallback(() => {
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
    }, []);

    const blockModel: BlockComponentModel2 = {
        onClick: setBlockClickedTrue,
        onFocusCapture: handleChildFocus,
        blockRef: blockRef,
    };

    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${nodeModel.blockId}-dummy-focus`} // don't change this name (used in refocusNode)
                    className="dummy-focus"
                    onChange={() => {}}
                />
            </div>
            <div
                key="content"
                className={clsx("block-content", { "block-no-padding": noPadding })}
                ref={contentRef}
                style={blockContentStyle}
            >
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = memo((props: BlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const [blockData, loading] = useWaveObjectValue<Block>(makeORef("block", props.nodeModel.blockId));
    const blockView = blockData?.meta?.view;
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    const [viewModel, setViewModel] = useState<ViewModel | null>(bcm?.viewModel ?? null);
    const [lazyLoading, setLazyLoading] = useState(false);

    useEffect(() => {
        if (loading || isBlank(props.nodeModel.blockId) || blockData == null) return;
        const existing = getBlockComponentModel(props.nodeModel.blockId)?.viewModel;
        if (existing != null && existing.viewType === blockView) {
            setViewModel(existing);
            return;
        }
        // Try sync first (eager or cached lazy)
        const syncVm = makeViewModel(props.nodeModel.blockId, blockView, props.nodeModel, tabModel);
        if (syncVm.viewComponent != null || !LazyRegistry.has(blockView)) {
            registerBlockComponentModel(props.nodeModel.blockId, { viewModel: syncVm });
            setViewModel(syncVm);
            return;
        }
        // Need async load
        setLazyLoading(true);
        makeViewModelAsync(props.nodeModel.blockId, blockView, props.nodeModel, tabModel).then((vm) => {
            registerBlockComponentModel(props.nodeModel.blockId, { viewModel: vm });
            setViewModel(vm);
            setLazyLoading(false);
        });
    }, [props.nodeModel.blockId, blockView, loading, blockData == null]);

    const viewModelRef = useRef<ViewModel | null>(viewModel);
    useEffect(() => {
        viewModelRef.current = viewModel;
    }, [viewModel]);

    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModelRef.current?.dispose?.();
        };
    }, []);
    if (loading || isBlank(props.nodeModel.blockId) || blockData == null || viewModel == null || lazyLoading) {
        return null;
    }
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});

const SubBlock = memo((props: SubBlockProps) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const [blockData, loading] = useWaveObjectValue<Block>(makeORef("block", props.nodeModel.blockId));
    const blockView = blockData?.meta?.view;
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    const [viewModel, setViewModel] = useState<ViewModel | null>(bcm?.viewModel ?? null);
    const [lazyLoading, setLazyLoading] = useState(false);

    useEffect(() => {
        if (loading || isBlank(props.nodeModel.blockId) || blockData == null) return;
        const existing = getBlockComponentModel(props.nodeModel.blockId)?.viewModel;
        if (existing != null && existing.viewType === blockView) {
            setViewModel(existing);
            return;
        }
        const syncVm = makeViewModel(props.nodeModel.blockId, blockView, props.nodeModel, tabModel);
        if (syncVm.viewComponent != null || !LazyRegistry.has(blockView)) {
            registerBlockComponentModel(props.nodeModel.blockId, { viewModel: syncVm });
            setViewModel(syncVm);
            return;
        }
        setLazyLoading(true);
        makeViewModelAsync(props.nodeModel.blockId, blockView, props.nodeModel, tabModel).then((vm) => {
            registerBlockComponentModel(props.nodeModel.blockId, { viewModel: vm });
            setViewModel(vm);
            setLazyLoading(false);
        });
    }, [props.nodeModel.blockId, blockView, loading, blockData == null]);

    const viewModelRef = useRef<ViewModel | null>(viewModel);
    useEffect(() => {
        viewModelRef.current = viewModel;
    }, [viewModel]);

    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModelRef.current?.dispose?.();
        };
    }, []);
    if (loading || isBlank(props.nodeModel.blockId) || blockData == null || viewModel == null || lazyLoading) {
        return null;
    }
    return <BlockSubBlock {...props} viewModel={viewModel} />;
});

export { Block, SubBlock };
