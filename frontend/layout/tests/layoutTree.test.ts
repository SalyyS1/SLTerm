// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { newLayoutNode } from "../lib/layoutNode";
import { computeMoveNode, moveNode } from "../lib/layoutTree";
import {
    DropDirection,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeMoveNodeAction,
} from "../lib/types";
import { newLayoutTreeState } from "./model";

// computeMoveNode re-looks-up both nodes in the tree (see the TODO in
// layoutTree.ts about the drag layer losing track of node fields), so both the
// target and the node being moved must already be in it. That matches the only
// caller in the app — LayoutModel's treeReducer dispatches ComputeMove for
// dragging an existing tile. Adding a brand-new block goes through InsertNode
// instead. A previous version of this test built a standalone node and expected
// computeMoveNode to move it, which returns undefined with
// "node or nodeToMove not set".

test("computeMove - reorder a sibling within its parent", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "A" });
    const nodeB = newLayoutNode(undefined, undefined, undefined, { blockId: "B" });
    const nodeC = newLayoutNode(undefined, undefined, undefined, { blockId: "C" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [nodeA, nodeB, nodeC]));

    // Dropping below a sibling reorders inside the shared parent rather than
    // creating a new container.
    const pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: nodeA.id,
        nodeToMoveId: nodeC.id,
        direction: DropDirection.Bottom,
    });
    assert(pendingAction !== undefined, "moving an in-tree node should produce a pending action");

    const op = pendingAction as LayoutTreeMoveNodeAction;
    assert(op.node.data!.blockId === "C", "the operation should carry the node being moved");
    assert(op.parentId === treeState.rootNode.id, "the parent should be the shared root");
    assert(op.index === 1, "C should land directly after A");
    assert(!op.insertAtRoot, "a reorder inside an existing parent is not an insert at root");

    moveNode(treeState, op);
    const order = treeState.rootNode.children!.map((n) => n.data!.blockId);
    assert(
        order.length === 3 && order[0] === "A" && order[1] === "C" && order[2] === "B",
        `root children should be [A, C, B], got [${order.join(", ")}]`
    );
});

test("computeMove - dropping to the side splits the target into a container", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "A" });
    const nodeB = newLayoutNode(undefined, undefined, undefined, { blockId: "B" });
    const nodeC = newLayoutNode(undefined, undefined, undefined, { blockId: "C" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [nodeA, nodeB, nodeC]));

    const pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: nodeA.id,
        nodeToMoveId: nodeC.id,
        direction: DropDirection.Right,
    });
    assert(pendingAction !== undefined, "a side drop should produce a pending action");

    const op = pendingAction as LayoutTreeMoveNodeAction;
    assert(op.node.data!.blockId === "C", "the operation should carry the node being moved");
    // Unlike Bottom, a side drop nests under the target itself.
    assert(op.parentId === nodeA.id, "the target becomes the parent");
    assert(op.index === 1, "C should be placed after A inside the new container");

    moveNode(treeState, op);
    assert(treeState.rootNode.children!.length === 2, "root should hold the new container plus B");
    const container = treeState.rootNode.children![0];
    const nested = container.children!.map((n) => n.data!.blockId);
    assert(
        nested.length === 2 && nested[0] === "A" && nested[1] === "C",
        `the container should hold [A, C], got [${nested.join(", ")}]`
    );
    assert(treeState.rootNode.children![1].data!.blockId === "B", "B should remain a direct child of root");
});

test("computeMove - noop action", () => {
    let nodeToMove = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeToMove" });
    let treeState = newLayoutTreeState(
        newLayoutNode(undefined, undefined, [
            nodeToMove,
            newLayoutNode(undefined, undefined, undefined, { blockId: "otherNode" }),
        ])
    );
    let moveAction: LayoutTreeComputeMoveNodeAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Left,
    };
    let pendingAction = computeMoveNode(treeState, moveAction);

    assert(pendingAction === undefined, "inserting a node to the left of itself should not produce a pendingAction");

    moveAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Right,
    };

    pendingAction = computeMoveNode(treeState, moveAction);
    assert(pendingAction === undefined, "inserting a node to the right of itself should not produce a pendingAction");
});
