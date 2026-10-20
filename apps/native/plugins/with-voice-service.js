const { withAndroidManifest } = require("expo/config-plugins");
module.exports = (config) =>
  withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application[0];
    application.service ??= [];
    const existing = application.service.find(
      (s) => s.$["android:name"] === "app.notifee.core.ForegroundService",
    );
    const service = existing ?? {
      $: { "android:name": "app.notifee.core.ForegroundService" },
    };
    service.$["android:foregroundServiceType"] = "mediaPlayback|microphone";
    if (!existing) application.service.push(service);
    return result;
  });
