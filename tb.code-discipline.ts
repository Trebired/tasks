export default {
  sourceRoot: ".",
  sourceExtensions: [".ts", ".tsx", ".js", ".jsx"],
  excludeDirs: ["node_modules", "dist", "tmp", ".vite", "test", "examples"],
  logging: {
    enabled: true,
    quiet: false,
  },
  tsconfigPaths: {
    normalize: "relative-dot-prefix",
    restoreAfterRun: false,
  },
  rules: {
    maxFileLines: {
      max: 350,
    },
    maxFunctionLines: {
      max: 50,
    },
    folderizeCompoundFiles: {},
    syncImports: {
      alias: {
        strategy: "random",
      },
      allowRelative: ["./"],
      packageJsonImports: {
        enabled: true,
        aliasPrefix: "#",
      },
    },
    dry: {
      helpers: [
        {
          from: "./internal/core/utils.ts",
          exportName: "clampPercent",
        },
        {
          from: "./internal/core/utils.ts",
          exportName: "nowIso",
        },
        {
          from: "./internal/core/utils.ts",
          exportName: "toRecord",
        },
      ],
    },
  },
};
