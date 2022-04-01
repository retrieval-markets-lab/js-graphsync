require("esbuild").serve(
  {
    servedir: "public",
  },
  {
    entryPoints: ["src/index.tsx"],
    outdir: "public",
    bundle: true,
    define: {
      global: "window",
      "process.env.DUMP_SESSION_KEYS": false,
    },
  }
);
