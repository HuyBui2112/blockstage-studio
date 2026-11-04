import { parsePack } from "./archive";
self.onmessage = async (
  event: MessageEvent<{ bytes: ArrayBuffer; name: string }>,
) => {
  try {
    const pack = parsePack(new Uint8Array(event.data.bytes), event.data.name);
    const hex = (value: ArrayBuffer) =>
      Array.from(new Uint8Array(value), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    pack.fingerprint = hex(
      await crypto.subtle.digest("SHA-256", event.data.bytes),
    );
    if (pack.source === "client")
      pack.sourceSha1 = hex(
        await crypto.subtle.digest("SHA-1", event.data.bytes),
      );
    const transfers = Object.values(pack.files).map(
      (bytes) => bytes.buffer as ArrayBuffer,
    );
    self.postMessage({ pack }, { transfer: [...new Set(transfers)] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
