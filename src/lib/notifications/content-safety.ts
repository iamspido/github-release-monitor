export function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeHtmlAttribute(value: string | null | undefined) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

export function safeExternalUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "#";

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    return "#";
  }

  return "#";
}

export function escapeMarkdownText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/([\\`*_[\]{}()#+\-.!|<>])/g, "\\$1");
}

export function escapeMarkdownLinkDestination(
  value: string | null | undefined,
) {
  const url = safeExternalUrl(value);
  if (url === "#") return url;

  return url.replace(/[()\\]/g, (char) => encodeURIComponent(char));
}
