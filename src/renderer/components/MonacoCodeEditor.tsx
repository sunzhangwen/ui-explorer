import { lazy, Suspense } from "react";
import type { EditorProps } from "@monaco-editor/react";

const Editor = lazy(async () => {
  const [reactMonaco, monaco, editorWorker, jsonWorker, typescriptWorker] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker")
  ]);

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") {
        return new jsonWorker.default();
      }
      if (label === "typescript" || label === "javascript") {
        return new typescriptWorker.default();
      }
      return new editorWorker.default();
    }
  };
  reactMonaco.loader.config({ monaco });

  return { default: reactMonaco.default };
});

export function MonacoCodeEditor(props: EditorProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <div
          className="editor-loading"
          style={{ height: props.height ?? "190px" }}
          aria-hidden="true"
        />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
