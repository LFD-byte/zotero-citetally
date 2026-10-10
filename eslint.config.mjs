import globals from "globals";

const zoteroGlobals = {
  Zotero: "readonly",
  Services: "readonly",
  ChromeUtils: "readonly",
  CiteCounts: "writable",
  CiteCountsLib: "writable",
};

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...zoteroGlobals, ...globals.browser, module: "readonly", pref: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^(install|startup|shutdown|uninstall|onMainWindowLoad|onMainWindowUnload|CiteCounts|CiteCountsLib)$" }],
      "no-undef": "error",
      "no-redeclare": "off",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
];
