const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// Expo inlines public environment values. Do not reuse transforms between variants.
config.cacheVersion = `mangumi:${process.env.EXPO_PUBLIC_API_URL || "preview"}:${process.env.EXPO_PUBLIC_BASE_PATH || "root"}`;
module.exports = config;
