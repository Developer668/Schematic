import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  root,
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
};
