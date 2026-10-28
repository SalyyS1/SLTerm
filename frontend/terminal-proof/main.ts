import "@xterm/xterm/css/xterm.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { TerminalRuntime } from "./terminal-runtime";
import { WorkspaceApp } from "./workspace-app";

createRoot(document.getElementById("root")!).render(createElement(WorkspaceApp, { runtime: new TerminalRuntime() }));
