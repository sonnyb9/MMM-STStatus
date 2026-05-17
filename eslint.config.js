module.exports = [
  {
    ignores: [
      "node_modules/**"
    ]
  },
  {
    files: ["MMM-STStatus.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        Module: "readonly",
        Log: "readonly",
        document: "readonly",
        window: "readonly"
      }
    }
  },
  {
    files: ["*.js"],
    ignores: ["MMM-STStatus.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
        require: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly"
      }
    }
  }
];
