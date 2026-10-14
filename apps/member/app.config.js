module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    baseUrl: process.env.EXPO_PUBLIC_BASE_PATH || "",
  },
});
