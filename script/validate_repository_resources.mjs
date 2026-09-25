#!/usr/bin/env node
import fs from "node:fs";

const path = "config/repository-resources.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));

function fail(message) {
  console.error(`repository resource registry: ${message}`);
  process.exitCode = 1;
}

if (!data || !Array.isArray(data.repositories)) {
  fail('"repositories" must be an array');
  process.exit();
}

const repositories = new Set();
const workers = new Set();

for (const [index, resource] of data.repositories.entries()) {
  const prefix = `repositories[${index}]`;

  if (!resource || typeof resource !== "object") {
    fail(`${prefix} must be an object`);
    continue;
  }

  if (typeof resource.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(resource.repository)) {
    fail(`${prefix}.repository must be OWNER/REPO`);
  } else if (repositories.has(resource.repository)) {
    fail(`duplicate repository mapping: ${resource.repository}`);
  } else {
    repositories.add(resource.repository);
  }

  if (resource.cloudflare !== undefined) {
    const cloudflare = resource.cloudflare;
    if (!cloudflare || typeof cloudflare !== "object") {
      fail(`${prefix}.cloudflare must be an object`);
      continue;
    }

    if (typeof cloudflare.accountId !== "string" || cloudflare.accountId.trim() === "") {
      fail(`${prefix}.cloudflare.accountId is required`);
    }

    if (typeof cloudflare.worker !== "string" || cloudflare.worker.trim() === "") {
      fail(`${prefix}.cloudflare.worker is required`);
    }

    if (typeof cloudflare.accountId === "string" && typeof cloudflare.worker === "string") {
      const workerKey = `${cloudflare.accountId}/${cloudflare.worker}`;
      if (workers.has(workerKey)) {
        fail(`duplicate Cloudflare Worker mapping: ${workerKey}`);
      } else {
        workers.add(workerKey);
      }
    }

    if (cloudflare.appUrl !== undefined) {
      if (cloudflare.appUrl !== "$request-origin") {
        try {
          const url = new URL(cloudflare.appUrl);
          if (url.protocol !== "https:" && url.protocol !== "http:") {
            fail(`${prefix}.cloudflare.appUrl must use http/https or $request-origin`);
          }
        } catch {
          fail(`${prefix}.cloudflare.appUrl must be a valid URL or $request-origin`);
        }
      }
    }
  }
}

if (!process.exitCode) {
  console.log(`repository resource registry: ${data.repositories.length} mapping(s) valid`);
}
