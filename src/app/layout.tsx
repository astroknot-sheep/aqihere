import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "AQIHere.earth — A little clarity in every breath",
  description:
    "Drop a pin. Understand the air. Explore local air quality with open data, nearby monitors, and transparent model estimates.",
  applicationName: "AQIHere",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "AQIHere.earth",
    description:
      "The air around you, understood. Free, open-source air-quality estimates for any point on the map.",
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
