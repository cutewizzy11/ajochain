import { Suspense } from "react";
import { CircleView } from "./CircleView";

export default function CirclePage() {
  return (
    <Suspense fallback={<p className="opacity-70">Loading…</p>}>
      <CircleView />
    </Suspense>
  );
}
