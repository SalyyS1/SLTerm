import * as csstree from "css-tree";
import type { CssNode, List, ListItem } from "css-tree";

export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; script-src-attr 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; child-src 'none'; worker-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; manifest-src 'none'; prefetch-src 'none'; navigate-to 'none'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
const BLOCKED_ELEMENTS = new Set([
    "applet",
    "base",
    "embed",
    "frame",
    "frameset",
    "iframe",
    "link",
    "meta",
    "object",
    "portal",
    "script",
    "noscript",
    "template",
]);
const URL_ATTRIBUTES = new Set([
    "action",
    "background",
    "cite",
    "codebase",
    "data",
    "formaction",
    "longdesc",
    "manifest",
    "poster",
    "profile",
    "src",
    "usemap",
]);
const DROP_ATTRIBUTES = new Set([
    "content",
    "crossorigin",
    "http-equiv",
    "integrity",
    "nonce",
    "ping",
    "referrerpolicy",
    "sandbox",
    "target",
]);
const FALLBACK_SAFE_ATTRIBUTES = /^(?:alt|aria-[\w:-]+|autocomplete|autofocus|cellpadding|cellspacing|checked|class|cols|colspan|contenteditable|controls|data-[\w:-]+|datetime|dir|disabled|download|fill|for|height|hidden|id|lang|loop|max|maxlength|media|method|min|minlength|multiple|muted|name|placeholder|points|poster|preload|readonly|rel|required|role|rows|rowspan|selected|size|spellcheck|start|step|stroke|stroke-width|style|tabindex|title|translate|type|value|viewbox|width|wrap|xmlns(?::[\w-]+)?)$/i;
const FALLBACK_URL_ATTRIBUTES = new Set(["poster", "src"]);
const FALLBACK_TAG_PATTERN = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*\?>|<[^>]*>/g;
const FALLBACK_ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const ENTITY_NAMES: Record<string, string> = {
    amp: "&",
    apos: "'",
    colon: ":",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    semi: ";",
    sol: "/",
};

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&#x([\da-f]{1,6});?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d{1,7});?/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&([a-z][a-z\d]+);/gi, (match, name: string) => ENTITY_NAMES[name.toLowerCase()] ?? match);
}

function isSafeDataUrl(value: string): boolean {
    const decoded = decodeHtmlEntities(value).trim();
    return /^(?:data:(?:image\/|audio\/|video\/|font\/|application\/(?:font-|vnd\.ms-fontobject)))/i.test(decoded) && !/[\u0000-\u001f\u007f]/.test(decoded);
}

function isSafeCssUrl(value: string): boolean {
    const decoded = decodeHtmlEntities(value).trim();
    return decoded.startsWith("#") || isSafeDataUrl(decoded);
}

function sanitizeCss(value: string, context: "stylesheet" | "declarationList"): string {
    try {
        const ast = csstree.parse(value, { context });
        csstree.walk(ast, {
            enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
                if (node.type === "Atrule" && ["import", "namespace"].includes(node.name.toLowerCase())) {
                    list.remove(item);
                } else if (node.type === "Url" && !isSafeCssUrl(node.value)) {
                    list.remove(item);
                }
            },
        });
        return csstree.generate(ast);
    } catch {
        // Invalid CSS is not useful in a static preview and can be dropped.
        return "";
    }
}

function unwrapElement(element: Element): void {
    const parent = element.parentNode;
    if (!parent) {
        element.remove();
        return;
    }
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    element.remove();
}

function sanitizeDomDocument(source: string): string {
    const document = new DOMParser().parseFromString(source, "text/html");
    for (const element of Array.from(document.querySelectorAll("*"))) {
        if (!element.isConnected) continue;
        const tagName = element.localName.toLowerCase();
        if (tagName === "form") {
            unwrapElement(element);
            continue;
        }
        if (BLOCKED_ELEMENTS.has(tagName)) {
            element.remove();
            continue;
        }
        if (tagName === "style") {
            element.textContent = sanitizeCss(element.textContent ?? "", "stylesheet");
        }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "srcset" || DROP_ATTRIBUTES.has(name)) {
                element.removeAttribute(attribute.name);
                continue;
            }
            if (URL_ATTRIBUTES.has(name)) {
                if (name === "src" || name === "poster") {
                    if (isSafeDataUrl(attribute.value)) element.setAttribute(attribute.name, decodeHtmlEntities(attribute.value).trim());
                    else element.removeAttribute(attribute.name);
                } else {
                    element.removeAttribute(attribute.name);
                }
                continue;
            }
            if (name === "style") {
                const css = sanitizeCss(attribute.value, "declarationList");
                if (css) element.setAttribute(attribute.name, css);
                else element.removeAttribute(attribute.name);
            }
        }
    }
    const root = document.documentElement;
    const head = document.head ?? document.createElement("head");
    if (!head.parentNode) root.insertBefore(head, root.firstChild);
    const policy = document.createElement("meta");
    policy.setAttribute("http-equiv", "Content-Security-Policy");
    policy.setAttribute("content", PREVIEW_CSP);
    head.prepend(policy);
    return `<!doctype html>${root.outerHTML}`;
}

function escapeFallbackAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function sanitizeFallbackTag(token: string): string {
    const opening = token.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)([\s\S]*?)>$/);
    if (!opening) return token;
    const [, closing, rawName, rawAttributes] = opening;
    const name = rawName.toLowerCase();
    if (BLOCKED_ELEMENTS.has(name)) return "";
    if (closing) return name === "form" ? "" : `</${name}>`;
    const attributes: string[] = [];
    const selfClosing = /\/\s*$/.test(rawAttributes);
    for (const match of rawAttributes.matchAll(FALLBACK_ATTRIBUTE_PATTERN)) {
        const [, rawAttributeName, doubleQuoted, singleQuoted, unquoted] = match;
        const attributeName = rawAttributeName.toLowerCase();
        if (!attributeName || attributeName === "/" || attributeName.startsWith("on") || attributeName === "href" || attributeName === "xlink:href" || attributeName === "srcset" || DROP_ATTRIBUTES.has(attributeName)) continue;
        const value = doubleQuoted ?? singleQuoted ?? unquoted;
        if (!FALLBACK_SAFE_ATTRIBUTES.test(attributeName) && !FALLBACK_URL_ATTRIBUTES.has(attributeName)) continue;
        if (FALLBACK_URL_ATTRIBUTES.has(attributeName)) {
            if (value == null || !isSafeDataUrl(value)) continue;
            attributes.push(`${attributeName}="${escapeFallbackAttribute(decodeHtmlEntities(value).trim())}"`);
        } else if (attributeName === "style") {
            const css = sanitizeCss(value ?? "", "declarationList");
            if (css) attributes.push(`style="${escapeFallbackAttribute(css)}"`);
        } else if (value == null) {
            attributes.push(attributeName);
        } else {
            attributes.push(`${attributeName}="${escapeFallbackAttribute(value)}"`);
        }
    }
    return `<${name}${attributes.length ? ` ${attributes.join(" ")}` : ""}${selfClosing ? " /" : ""}>`;
}

function sanitizeFallbackDocument(source: string): string {
    let sanitized = source.replace(/<\s*(script|iframe|object|embed|applet|frame|frameset|portal|noscript|template|meta|link|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    sanitized = sanitized.replace(/<\s*(script|iframe|object|embed|applet|frame|frameset|portal|noscript|template|meta|link|base)\b[^>]*\/?\s*>/gi, "");
    sanitized = sanitized.replace(/<\?xml[^>]*\?>/gi, "").replace(FALLBACK_TAG_PATTERN, (token) => {
        if (/^<!--|^<!doctype/i.test(token)) return token;
        return sanitizeFallbackTag(token);
    });
    sanitized = sanitized.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, opening: string, css: string, closing: string) => `${opening}${sanitizeCss(css, "stylesheet")}${closing}`);
    const head = /<head\b[^>]*>/i;
    const html = /<html\b[^>]*>/i;
    if (head.test(sanitized)) return sanitized.replace(head, (tag) => `${tag}${CSP_META}`);
    if (html.test(sanitized)) return sanitized.replace(html, (tag) => `${tag}<head>${CSP_META}</head>`);
    return `<!doctype html><html><head>${CSP_META}</head><body>${sanitized}</body></html>`;
}

export function isPreviewableProjectPath(path: string): boolean {
    return /\.(?:html?|xhtml)$/i.test(path);
}

/**
 * Build a static, isolated preview document. Resource-bearing markup is
 * reduced to data URLs, active elements and event attributes are removed, and
 * the iframe provides a second boundary with a unique sandbox origin.
 */
export function projectPreviewDocument(source: string): string {
    return typeof DOMParser === "function" ? sanitizeDomDocument(source) : sanitizeFallbackDocument(source);
}
