// These checks are a conservative upload preflight, not a malware scan.
// An OpenAction may be a harmless initial page view rather than executable code.
const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const coordinate = `(?:null|${number})`;
const destinationView = [
  "/(?:Fit|FitB)",
  `/(?:FitH|FitV|FitBH|FitBV)\\s+${coordinate}`,
  `/XYZ\\s+${coordinate}\\s+${coordinate}\\s+${coordinate}`,
  `/FitR\\s+${number}\\s+${number}\\s+${number}\\s+${number}`
].join("|");
const initialPageView = new RegExp(`^\\s*\\[\\s*\\d+\\s+\\d+\\s+R\\s+(?:${destinationView})\\s*\\]`);

export function hasUnsafePdfFeatures(bytes: Uint8Array): boolean {
  // PDF names can encode characters as #xx; do not let escaped action names
  // evade the same checks as their plain-text equivalents.
  const searchable = Buffer.from(bytes).toString("latin1").replace(
    /\/[^\s\x00()[\]<>%/]+/g,
    (name) => name.replace(/#([a-f\d]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  );
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFiles?)\b/i.test(searchable)) return true;
  for (const action of searchable.matchAll(/\/OpenAction\b/gi)) {
    // Only explicit internal page destinations are allowed here. Dictionaries,
    // indirect action references, named destinations and malformed values remain
    // rejected until they can be safely resolved rather than guessed at.
    if (!initialPageView.test(searchable.slice(action.index + action[0].length))) return true;
  }
  return false;
}
