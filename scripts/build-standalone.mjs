/**
 * Build the one-file version of the site, with the catalog inlined.
 *
 * The hosted page fetches data/programs.json. A single file that gets emailed
 * around, or published as a Claude Artifact, cannot fetch anything, so the data
 * goes inside the HTML instead.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const data = JSON.parse(await readFile("data/programs.json", "utf8"));

data.programs = data.programs
  .filter((p) => p.audience !== "adult")
  .map((p) => ({ ...p, blurb: (p.blurb || "").slice(0, 300) }));

const inline = "<script>window.__PARKPLAY_DATA__ = " +
  JSON.stringify(data).replace(/</g, "\\u003c") + ";</script>";

const out = html.replace("<script>\n(function(){", inline + "\n<script>\n(function(){");
if (out === html) throw new Error("could not find the app script tag to inject before");

await mkdir("dist", { recursive: true });
await writeFile("dist/parkplay-standalone.html", out);
console.log(`wrote dist/parkplay-standalone.html · ${(out.length / 1048576).toFixed(2)} MB · ${data.programs.length} programs`);

/* A published Artifact supplies its own document skeleton, so it gets the head
   contents plus the body, without the wrapper tags. */
const head = out.slice(out.indexOf("<title>"), out.indexOf("</style>") + 8);
const body = out.slice(out.indexOf("<body>") + 6, out.indexOf("</body>"));
const artifactPath = process.env.PARKPLAY_ARTIFACT_OUT || "dist/parkplay-artifact.html";
await writeFile(artifactPath, head + "\n" + body.trim() + "\n");
console.log(`wrote ${artifactPath}`);
