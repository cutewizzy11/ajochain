import { Suspense } from "react";
import { CircleView } from "./CircleView";
import { Loader } from "@/components/motion";

export default function CirclePage() {
  return (
    <Suspense fallback={<Loader label="Opening circle" />}>
      <CircleView />
    </Suspense>
  );
}
