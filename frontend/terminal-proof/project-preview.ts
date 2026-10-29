export const PREVIEW_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

export function isPreviewableProjectPath(path: string): boolean {
    return /\.(?:html?|xhtml)$/i.test(path);
}

/**
 * Keep preview content in a unique sandbox origin. Scripts, network requests,
 * forms and parent navigation stay disabled even when the project contains
 * hostile HTML. No Tauri/native bridge is injected into this document.
 */
export function projectPreviewDocument(source: string): string {
    const policy = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
    if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${policy}`);
    if (/<html(?:\s[^>]*)?>/i.test(source)) return source.replace(/<html(?:\s[^>]*)?>/i, (tag) => `${tag}<head>${policy}</head>`);
    return `<!doctype html><html><head>${policy}</head><body>${source}</body></html>`;
}
