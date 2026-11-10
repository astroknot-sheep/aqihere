import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "AQIHere · Air quality map",
  description:
    "Regional air-quality estimates, measured street coverage, and forecasts.",
  applicationName: "AQIHere",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "AQIHere.earth",
    description:
      "Compare air-quality estimates with nearby monitoring stations.",
    type: "website",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f9f4",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
