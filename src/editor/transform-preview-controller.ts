import type { Material } from "../core/catalog";
import type { NeighborRules } from "../core/profile";
import type { CoordinateSpace, EditorDocument, PivotMode } from "./model";
import {
  createTransformPreviewSession,
  previewTransform,
  type TransformIntent,
} from "./operations";
import type { EditorViewState } from "./view-state";

export type TransformPreviewContext = {
  document: EditorDocument;
  catalog: Material[];
  scope: string;
  epoch: string;
  revision: number;
  selection: string[];
  space: CoordinateSpace;
  pivot: PivotMode;
  view: EditorViewState;
  autoConnections: boolean;
  rules?: NeighborRules;
};

/** One immutable, live gesture only. Reset before commit/cancel or lifecycle work.
 * Never exports a candidate-validation bypass or a durable validation token. */
export function createTransformPreviewController() {
  let current:
    | {
        context: TransformPreviewContext;
        session: ReturnType<typeof createTransformPreviewSession>;
      }
    | undefined;
  const reset = () => {
    current = undefined;
  };
  return {
    reset,
    preview(context: TransformPreviewContext, intent: TransformIntent) {
      const { document, catalog, selection, space, pivot, rules } = context;
      if (context.autoConnections) {
        reset();
        return previewTransform(
          document,
          selection,
          intent,
          space,
          pivot,
          catalog,
          rules,
        );
      }
      const old = current?.context;
      const same =
        old &&
        old.document === document &&
        old.catalog === catalog &&
        old.scope === context.scope &&
        old.epoch === context.epoch &&
        old.revision === context.revision &&
        old.space === space &&
        old.pivot === pivot &&
        old.view === context.view &&
        old.autoConnections === context.autoConnections &&
        old.rules === rules &&
        old.selection.length === selection.length &&
        old.selection.every((id, index) => id === selection[index]);
      if (!same) {
        reset();
        try {
          current = {
            context: { ...context, selection: [...selection] },
            session: createTransformPreviewSession(document, catalog),
          };
        } catch {
          // Preserve the existing full-path diagnostic/repair behavior when the
          // current base cannot establish a proof (e.g. missing game profile).
          return previewTransform(
            document,
            selection,
            intent,
            space,
            pivot,
            catalog,
            rules,
          );
        }
      }
      return current!.session.preview(selection, intent, space, pivot);
    },
  };
}
