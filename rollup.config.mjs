import { makeRollupConfig } from "@jspsych/config/rollup";
import esbuild from "rollup-plugin-esbuild";

const newConfig = makeRollupConfig("jsPsychPluginVoiceResponse").map((config) => {
  // Find the IIFE config with target: "es2015"
  if (Array.isArray(config.plugins) && config.output?.file?.endsWith(".browser.min.js")) {
    const updatedPlugins = config.plugins.map((plugin) => {
      // Find esbuild and replace it with target: "es2020"
      if (plugin.name === "esbuild") {
        return esbuild({
          loaders: { ".json": "json" },
          minify: true,
          target: "es2020"
        });
      }
      return plugin;
    });
    return { ...config, plugins: updatedPlugins };
  }
  return config;
});

export default newConfig;
