import { Suspense } from "react";
import { CircleView } from "./CircleView";

export default function CirclePage() {
  return (
    <Suspense fallback={<p className="font-mono text-xs text-muted">Loading circle…</p>}>
      <CircleView />
    </Suspense>
  );
}
