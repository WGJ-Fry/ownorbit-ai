process.env.LIFEOS_DISTRIBUTION = "unsigned";
process.env.LIFEOS_RELEASE_STRICT = "1";

await import("./release-check.mjs");
