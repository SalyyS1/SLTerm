// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { atoms, useSettingsKeyAtom } from "@/store/global";
import { mountedTabIdsAtom } from "@/store/tab-model";
import { hostSwitchesTabsInDocument } from "@/util/host";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef } from "react";
import { resolveMountedTabs, touchRecency } from "./tab-mount-policy";

/**
 * The tabs this document has mounted, stacked, with one of them shown.
 *
 * Inactive tabs are hidden with `visibility`, not `display`, and every tab is
 * absolutely positioned at full size. That combination is the point: a
 * `display: none` subtree has no dimensions, so xterm would measure a zero-sized
 * grid and resize the shell to nonsense. Hidden this way each tab keeps its real
 * geometry, and a switch costs a repaint instead of a teardown and replay.
 *
 * How many stay mounted is capped — see `tab-mount-policy`. Warm tabs are the whole
 * point of this component, but they are not free, and nothing else bounds them once
 * the per-tab webviews are gone.
 */
const StackedTabs = memo(({ tabIds, activeTabId }: { tabIds: string[]; activeTabId: string }) => {
    const [mountedTabIds, setMountedTabIds] = useAtom(mountedTabIdsAtom);
    const maxWarmTabs = useSettingsKeyAtom("window:maxtabcachesize");
    const tabIdKey = tabIds.join(",");
    // View-local bookkeeping, not state: recency decides what to evict and never
    // needs to trigger a render of its own.
    const recencyRef = useRef<string[]>([]);

    useEffect(() => {
        recencyRef.current = touchRecency(recencyRef.current, activeTabId);
        setMountedTabIds((prev) =>
            resolveMountedTabs({
                prev,
                tabIds,
                activeTabId,
                recency: recencyRef.current,
                maxWarm: maxWarmTabs,
            })
        );
    }, [activeTabId, tabIdKey, maxWarmTabs, setMountedTabIds]);

    return (
        <div className="relative flex-grow overflow-hidden">
            {mountedTabIds.map((tabId) => (
                <div
                    key={tabId}
                    className="absolute inset-0 flex flex-row"
                    style={tabId === activeTabId ? undefined : { visibility: "hidden" }}
                    aria-hidden={tabId === activeTabId ? undefined : true}
                >
                    {/* Per tab, so one tab's crash cannot take the others down. */}
                    <ErrorBoundary>
                        <TabContent tabId={tabId} />
                    </ErrorBoundary>
                </div>
            ))}
        </div>
    );
});

StackedTabs.displayName = "StackedTabs";

const WorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    // Fixed for the life of the page: a property of the shell we loaded in.
    const inDocumentTabs = useMemo(() => hostSwitchesTabsInDocument(), []);

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            <TabBar key={ws.oid} workspace={ws} />
            <div className="flex flex-row flex-grow overflow-hidden">
                {inDocumentTabs ? (
                    <>
                        <StackedTabs tabIds={ws?.tabids ?? []} activeTabId={tabId} />
                        <Widgets />
                        <ModalsRenderer />
                    </>
                ) : (
                    <ErrorBoundary key={tabId}>
                        {tabId === "" ? (
                            <CenteredDiv>No Active Tab</CenteredDiv>
                        ) : (
                            <div className="flex flex-row h-full w-full">
                                <TabContent key={tabId} tabId={tabId} />
                                <Widgets />
                            </div>
                        )}
                        <ModalsRenderer />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
