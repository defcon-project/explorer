/** Inert JSON can be read by the external client bundle under script-src self. */
export function renderBootData(data: Record<string, unknown>): string {
  // Escape every < so untrusted strings cannot terminate the script data block.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="deftrack-boot">${json}</script>`;
}
