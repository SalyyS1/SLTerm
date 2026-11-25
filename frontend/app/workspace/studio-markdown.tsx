// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Lightweight, zero-dependency, XSS-safe Markdown + Code + Diff renderer for
// SLTerm's Rem Aqua AI Studio chat bubbles.

import * as React from "react";

export interface ParsedSegment {
    kind: "text" | "code";
    lang?: string;
    content: string;
}

/** Splits a conversational message into alternating text and fenced code blocks. */
export function parseMessageSegments(raw: string): ParsedSegment[] {
    if (!raw) return [];
    const lines = raw.split(/\r?\n/);
    const out: ParsedSegment[] = [];
    let inFence = false;
    let fenceLang = "";
    let buf: string[] = [];

    const flush = (kind: "text" | "code") => {
        if (buf.length === 0) return;
        out.push({
            kind,
            lang: kind === "code" ? fenceLang : undefined,
            content: buf.join("\n"),
        });
        buf = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("```")) {
            if (!inFence) {
                flush("text");
                inFence = true;
                fenceLang = trimmed.slice(3).trim().toLowerCase();
            } else {
                flush("code");
                inFence = false;
                fenceLang = "";
            }
            continue;
        }
        buf.push(line);
    }
    flush(inFence ? "code" : "text");
    return out;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return tokens.map((tok, i) => {
        if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
            return (
                <code key={i} className="studio-inline-code">
                    {tok.slice(1, -1)}
                </code>
            );
        }
        if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
            return <strong key={i}>{tok.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={i}>{tok}</React.Fragment>;
    });
}

export const StudioMessageBody: React.FC<{ text: string; onCopy?: (code: string) => void }> = ({
    text,
    onCopy,
}) => {
    const segments = React.useMemo(() => parseMessageSegments(text), [text]);
    return (
        <div className="studio-md-body">
            {segments.map((seg, idx) => {
                if (seg.kind === "code") {
                    const isDiff = seg.lang === "diff" || seg.lang === "patch";
                    return (
                        <div key={idx} className="studio-code-card">
                            <div className="studio-code-head">
                                <span>{seg.lang || "code"}</span>
                                <button
                                    type="button"
                                    className="studio-code-copy"
                                    onClick={() => {
                                        navigator.clipboard?.writeText(seg.content);
                                        onCopy?.(seg.content);
                                    }}
                                >
                                    Copy
                                </button>
                            </div>
                            <pre className="studio-code-pre">
                                {isDiff
                                    ? seg.content.split("\n").map((ln, li) => {
                                          const cls =
                                              ln.startsWith("+") && !ln.startsWith("+++")
                                                  ? "diff-add"
                                                  : ln.startsWith("-") && !ln.startsWith("---")
                                                  ? "diff-del"
                                                  : ln.startsWith("@@")
                                                  ? "diff-hunk"
                                                  : "";
                                          return (
                                              <div key={li} className={cls}>
                                                  {ln || " "}
                                              </div>
                                          );
                                      })
                                    : seg.content}
                            </pre>
                        </div>
                    );
                }

                return (
                    <div key={idx} className="studio-md-text">
                        {seg.content.split("\n").map((line, li) => {
                            const t = line.trim();
                            if (!t) return <div key={li} className="studio-md-spacer" />;
                            if (t.startsWith("### ")) {
                                return (
                                    <h4 key={li} className="studio-md-h">
                                        {renderInlineFormatting(t.slice(4))}
                                    </h4>
                                );
                            }
                            if (t.startsWith("## ")) {
                                return (
                                    <h3 key={li} className="studio-md-h">
                                        {renderInlineFormatting(t.slice(3))}
                                    </h3>
                                );
                            }
                            if (t.startsWith("- ") || t.startsWith("* ")) {
                                return (
                                    <div key={li} className="studio-md-bullet">
                                        <span className="studio-md-dot">❄</span>
                                        <span>{renderInlineFormatting(t.slice(2))}</span>
                                    </div>
                                );
                            }
                            return <p key={li}>{renderInlineFormatting(line)}</p>;
                        })}
                    </div>
                );
            })}
        </div>
    );
};
