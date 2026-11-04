import { decodeNbtFile } from "./nbt-reader";
import { inspectStructure } from "./structure-import";
import type { Material } from "../core/catalog";
import type { EditorDocument } from "../editor/model";
self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    name: string;
    workspace: EditorDocument["workspace"];
    catalog: Material[];
  }>,
) => {
  try {
    const { bytes, name, workspace, catalog } = event.data;
    self.postMessage({
      result: inspectStructure(
        await decodeNbtFile(new Uint8Array(bytes)),
        name,
        workspace,
        catalog,
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
