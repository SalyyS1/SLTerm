import { useEffect, useRef, useState } from "react";
import { TerminalRuntime } from "./terminal-runtime";
import { IconButton } from "./workspace-layout";

export function TerminalSearch({
    runtime,
    paneId,
    close,
}: {
    runtime: TerminalRuntime;
    paneId: number;
    close: () => void;
}) {
    const [query, setQuery] = useState("");
    const [found, setFound] = useState(true);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        input.current?.focus();
    }, []);
    useEffect(() => {
        setFound(runtime.search(paneId, query));
        return () => runtime.clearSearch(paneId);
    }, [runtime, paneId, query]);
    return (
        <div
            className="search-bar"
            role="search"
            aria-label="Tìm output terminal"
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                }
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    setFound(runtime.search(paneId, query, event.shiftKey));
                }
            }}
        >
            <input
                ref={input}
                aria-label="Tìm trong terminal"
                placeholder="Tìm trong terminal…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />
            <span className="search-result" role="status">
                {query && !found ? "Không thấy" : ""}
            </span>
            <IconButton
                icon="chevron-up"
                label="Kết quả trước"
                onClick={() => setFound(runtime.search(paneId, query, true))}
            />
            <IconButton
                icon="chevron-down"
                label="Kết quả tiếp"
                onClick={() => setFound(runtime.search(paneId, query))}
            />
            <IconButton icon="close" label="Đóng tìm kiếm" onClick={close} />
        </div>
    );
}
