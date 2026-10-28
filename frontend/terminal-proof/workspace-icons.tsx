import React, { type SVGProps } from "react";

export type IconName =
    | "terminal" | "plus" | "close" | "split-horizontal" | "split-vertical"
    | "maximize" | "restore" | "search" | "chevron-up" | "chevron-down"
    | "settings" | "sidebar" | "folder" | "sun" | "moon" | "keyboard"
    | "more" | "rename" | "grid" | "check" | "arrow-right" | "grip";

const paths: Record<IconName, React.ReactNode> = {
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    "split-horizontal": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
    "split-vertical": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" /></>,
    maximize: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
    restore: <><path d="M9 8V4h11v11h-4" /><rect x="4" y="8" width="12" height="12" rx="1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    "chevron-up": <path d="m6 15 6-6 6 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    settings: <><path d="m10 3-.6 2.2-2 .9-2-.6-2 3.5 1.5 1.6v2.8L3.4 15l2 3.5 2-.6 2 .9.6 2.2h4l.6-2.2 2-.9 2 .6 2-3.5-1.5-1.6v-2.8l1.5-1.6-2-3.5-2 .6-2-.9L14 3z" /><circle cx="12" cy="12" r="3" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>,
    moon: <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z" />,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8" /></>,
    more: <><circle cx="5" cy="12" r=".8" /><circle cx="12" cy="12" r=".8" /><circle cx="19" cy="12" r=".8" /></>,
    rename: <><path d="m14 5 5 5M4 20l4.8-1 11-11a2.1 2.1 0 0 0-5-5l-11 11z" /><path d="M13 20h8" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    "arrow-right": <path d="M4 12h16m-6-6 6 6-6 6" />,
    grip: <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" />,
};

export function Icon({ name, size = 16, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props} aria-hidden="true">{paths[name]}</svg>;
}
