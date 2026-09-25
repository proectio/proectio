#!/usr/bin/env node
import fs from "node:fs";

const requiredFiles = [
  "public/favicon.svg",
  "public/icon-32.png",
  "public/icon-180.png",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/manifest.webmanifest",
  "public/sw.js",
];

for (const path of requiredFiles) {
  if (!fs.existsSync(path)) throw new Error(`PWA asset missing: ${path}`);
}

const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
if (manifest.name !== "Proectio" || manifest.short_name !== "Proectio") {
  throw new Error("PWA manifest must use the Proectio app name");
}
if (manifest.display !== "standalone" || manifest.start_url !== "/" || manifest.scope !== "/") {
  throw new Error("PWA manifest must be installable at the application root in standalone mode");
}

const iconSizes = new Set((manifest.icons ?? []).map((icon) => icon.sizes));
for (const size of ["192x192", "512x512"]) {
  if (!iconSizes.has(size)) throw new Error(`PWA manifest missing required icon size: ${size}`);
}

const index = fs.readFileSync("index.html", "utf8");
for (const reference of ["/manifest.webmanifest", "/favicon.svg", "/icon-180.png"]) {
  if (!index.includes(reference)) throw new Error(`index.html missing PWA reference: ${reference}`);
}

const serviceWorker = fs.readFileSync("public/sw.js", "utf8");
for (const protectedPath of ["/api/", "/auth/"]) {
  if (!serviceWorker.includes(protectedPath)) {
    throw new Error(`service worker must explicitly exclude authenticated path: ${protectedPath}`);
  }
}

console.log("PWA assets and install metadata are valid");
