// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { defineConfig } from "vite";

// Set by `tauri dev` when targeting a remote device; unused for desktop.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Keep Rust compiler output visible in the terminal.
  clearScreen: false,
  server: {
    // Must match build.devUrl in src-tauri/tauri.conf.json.
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 (Windows) is evergreen Chromium; WKWebView on macOS 12+ is Safari 15+.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
