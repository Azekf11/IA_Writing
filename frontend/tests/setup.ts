import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount rendered components between tests. Vitest runs this after a test file's own afterEach
// hooks, and React runs an effect still waiting as it unmounts: a file that resets what its
// components write from their effects calls cleanup() first.
afterEach(() => cleanup());
