"use client";

import { useState } from "react";
import { TextEditor } from "@/components/text-editor";

export function RewriteWorkspace() {
  const [text, setText] = useState("");

  return <TextEditor value={text} onChange={setText} />;
}
