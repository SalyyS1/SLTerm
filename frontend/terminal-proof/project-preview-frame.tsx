import { useMemo } from "react";
import { projectPreviewDocument } from "./project-preview";
import "./project-preview.css";

export function ProjectPreview({ path, source }: { path: string; source: string }) {
    const srcDoc = useMemo(() => projectPreviewDocument(source), [source]);
    return <div className="project-preview-frame" aria-label={`Preview ${path}`}>
        <iframe
            className="project-preview"
            title={`Preview ${path}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
        />
    </div>;
}
