import { makeRollupConfig } from "@jspsych/config/rollup";
import esbuild from "rollup-plugin-esbuild";

const config = makeRollupConfig("jsPsychPluginVoiceResponse");

const newConfig = config.map((config) => {
  if (config.output.file?.endsWith(".browser.min.js")) {
    const modifiedConfig = {
      ...config,
      plugins: [
        ...config.plugins,
        esbuild({
          // loaders: "json",
          minify: true,
          target: "es2020",
        }),
      ],
    };

    return modifiedConfig;
  } else {
    return config;
  }
});

console.log(newConfig);
export default newConfig;
