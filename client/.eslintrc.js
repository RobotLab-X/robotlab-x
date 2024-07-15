module.exports = {
  // other ESLint configurations
  plugins: [
    "react-hooks"
    // other plugins
  ],
  rules: {
    "react-hooks/rules-of-hooks": "error", // Checks rules of Hooks
    "react-hooks/exhaustive-deps": "warn", // Checks effect dependencies
    "no-unused-vars": "warn"
    // other rules
  }
}
