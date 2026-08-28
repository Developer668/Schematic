import type { Metadata } from "next";
import "../../frontend/src/index.css";

export const metadata: Metadata = {
  title: "Schematic · Hardware WebMCP Studio",
  description: "Design, simulate, debug, and source connected hardware with an agent-native workbench.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
