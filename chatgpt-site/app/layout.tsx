import type { Metadata } from "next";
import "../../frontend/src/index.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://schematic-hardware-workspace.decipherer71.chatgpt.site"),
  title: "Schematic · Hardware WebMCP Studio",
  description: "Design connected hardware, preview typed outcomes, and edit source with an agent-native workbench.",
  openGraph: {
    title: "Schematic · Hardware WebMCP Studio",
    description: "Design connected hardware, preview typed outcomes, and edit source with an agent-native workbench.",
    images: [{ url: "/social-preview.png", width: 1200, height: 630, alt: "Schematic hardware workbench" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Schematic · Hardware WebMCP Studio",
    description: "Design connected hardware, preview typed outcomes, and edit source with an agent-native workbench.",
    images: ["/social-preview.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
