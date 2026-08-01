import { lazy, Suspense } from "react";
import type { EditorProps } from "@monaco-editor/react";

const Editor = lazy(() => import("@monaco-editor/react"));

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
