import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Skin and Smile Dental Clinic POS",
    short_name: "Skin & Smile POS",
    start_url: "/",
    display: "standalone",
    icons: [
      {
        src: "/icons/skin-and-smile-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/skin-and-smile-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
