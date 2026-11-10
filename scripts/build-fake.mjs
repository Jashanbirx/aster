// Bundles the fake claude.ai runtime used by the end-to-end tests.
import * as esbuild from "esbuild";
await esbuild.build({ entryPoints: ["test/fake-claude.js"], bundle: true, format: "iife", outfile: "test/fake-claude.bundle.js", logLevel: "warning" });
