// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { atoms } from "@/store/global";
import { mountedTabIdsAtom } from "@/store/tab-model";
import { hostSwitchesTabsInDocument } from "@/util/host";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo } from "react";

/**
 * The tabs this document has mounted, stacked, with one of them shown.
 *
 * Inactive tabs are hidden with `visibility`, not `display`, and every tab is
 * absolutely positioned at full size. That combination is the point: a
 * `display: none` subtree has no dimensions, so xterm would measure a zero-sized
 * grid and resize the shell to nonsense. Hidden this way each tab keeps its real
 * geometry, and a switch costs a repaint instead of a teardown and replay.
 */
const StackedTabs = memo(({ tabIds, activeTabId }: { tabIds: string[]; activeTabId: string }) => {
    const [mountedTabIds, setMountedTabIds] = useAtom(mountedTabIdsAtom);
    const tabIdKey = tabIds.join(",");

    useEffect(() => {
        setMountedTabIds((prev) => {
            // A tab closed from anywhere else stops existing in the workspace, and
            // its view has to go with it.
            const alive = prev.filter((id) => tabIds.includes(id));
            if (activeTabId && tabIds.includes(activeTabId) && !alive.includes(activeTabId)) {
                return [...alive, activeTabId];
            }
            // An unchanged list must be the same array, or this effect loops.
            return alive.length === prev.length ? prev : alive;
        });
    }, [activeTabId, tabIdKey, setMountedTabIds]);

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
