import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Preload only the two faces used above the fold (body + display). The other
 * weights stay lazy so a first visit downloads the minimum.
 */
function preloadCriticalFonts(): Plugin {
  return {
    name: "preload-critical-fonts",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        if (!context.bundle) return html;
        const wanted = [/dm-sans-latin-400-normal-.*\.woff2$/, /fraunces-latin-600-normal-.*\.woff2$/];
        const links = Object.keys(context.bundle)
          .filter((file) => wanted.some((pattern) => pattern.test(file)))
          .map((file) => `<link rel="preload" as="font" type="font/woff2" href="/${file}" crossorigin />`);
        if (!links.length) return html;
        return html.replace("</head>", `    ${links.join("\n    ")}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        id: "/",
        name: "Smart Café",
        short_name: "Café",
        description: "Order from your table, track it live, and pay in seconds.",
        lang: "en",
        categories: ["food", "shopping"],
        theme_color: "#2b1d14",
        background_color: "#faf6f0",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Never answer an API or websocket request with the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        runtimeCaching: [
          {
            // The menu changes rarely; show the last good copy instantly and
            // refresh in the background. Never cache table/session responses.
            urlPattern: /\/api\/public\/menu(?:\?.*)?$/,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "public-menu",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:woff2?|ttf|otf)$/i,
            method: "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:png|jpe?g|webp|avif|gif|svg)$/i,
            method: "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    preloadCriticalFonts(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Keep the long-lived framework code in its own cacheable chunks.
        // Rolldown (Vite 8) requires the function form.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("socket.io-client") || id.includes("engine.io-client") || id.includes("socket.io-parser")) {
            return "vendor-socket";
          }
          if (id.includes("@tanstack/react-query")) return "vendor-query";
          if (id.includes("react-router")) return "vendor-react";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
      },
    },
  },
});
