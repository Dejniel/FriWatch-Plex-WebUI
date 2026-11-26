/** Clipboard API requires a secure context; local HTTP installations can use selection. */
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A denied Clipboard API permission can still allow a user-initiated copy.
    }
  }
  const focused = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand?.("copy"))
      throw new Error("Copy the path manually.");
  } finally {
    input.remove();
    focused?.focus({ preventScroll: true });
  }
}
