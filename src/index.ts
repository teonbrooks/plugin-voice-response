import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";
import { pipeline } from "@huggingface/transformers";
import { WaveFile } from "wavefile";

import { version } from "../package.json";

const info = <const>{
  name: "plugin-voice-response",
  version: version,
  parameters: {
    /** The HTML content to be displayed. */
    stimulus: {
      type: ParameterType.HTML_STRING,
      default: undefined,
    },
    /** How long to display the stimulus in milliseconds. The visibility CSS property of the stimulus will be set to `hidden` after this time has elapsed. If this is null, then the stimulus will remain visible until the trial ends. */
    stimulus_duration: {
      type: ParameterType.INT,
      default: null,
    },
    /** The maximum length of the recording, in milliseconds. The default value is intentionally set low because of the potential to accidentally record very large data files if left too high. You can set this to `null` to allow the participant to control the length of the recording via the done button, but be careful with this option as it can lead to crashing the browser if the participant waits too long to stop the recording.  */
    recording_duration: {
      type: ParameterType.INT,
      default: 2000,
    },
    /** Whether to show a button on the screen that the participant can click to finish the recording. */
    show_done_button: {
      type: ParameterType.BOOL,
      default: true,
    },
    /** The label for the done button. */
    done_button_label: {
      type: ParameterType.STRING,
      default: "Continue",
    },
    /** The label for the record again button enabled when `allow_playback: true`.
     */
    record_again_button_label: {
      type: ParameterType.STRING,
      default: "Record again",
    },
    /** The label for the accept button enabled when `allow_playback: true`. */
    accept_button_label: {
      type: ParameterType.STRING,
      default: "Continue",
    },
    /** Whether to allow the participant to listen to their recording and decide whether to rerecord or not. If `true`, then the participant will be shown an interface to play their recorded audio and click one of two buttons to either accept the recording or rerecord. If rerecord is selected, then stimulus will be shown again, as if the trial is starting again from the beginning. */
    allow_playback: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** If `true`, then an [Object URL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL) will be generated and stored for the recorded audio. Only set this to `true` if you plan to reuse the recorded audio later in the experiment, as it is a potentially memory-intensive feature. */
    save_audio_url: {
      type: ParameterType.BOOL,
      default: true,
    },
    /** Whether or not to download the audio response automatically after recording ends. If true, the 'response' value will be the name of the downloaded file rather than a base64 representation of the data. Default is false. */
    local_download: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** If local_download is true, this sets the base file name of the downloaded file, which will be followed by a timestamp. The default is 'audio-response'. */
    download_file_name: {
      type: ParameterType.STRING,
      default: "audio-response",
    },
  },
  data: {
    /** The time, since the onset of the stimulus, for the participant to click the done button. If the button is not clicked (or not enabled), then `rt` will be `null`. */
    rt: {
      type: ParameterType.INT,
    },
    /** The base64-encoded audio data (if local_download is false) or name of the downloaded file (if local_download is true). */
    response: {
      type: ParameterType.STRING,
    },
    /** The HTML content that was displayed on the screen. */
    stimulus: {
      type: ParameterType.HTML_STRING,
    },
    /** This is an estimate of when the stimulus appeared relative to the start of the audio recording. The plugin is configured so that the recording should start prior to the display of the stimulus. We have not yet been able to verify the accuracy of this estimate with external measurement devices. */
    estimated_stimulus_onset: {
      type: ParameterType.INT,
    },
    /** A URL to a copy of the audio data. */
    audio_url: {
      type: ParameterType.STRING,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * **plugin-voice-response**
 *
 * A plugin for detecting voice response. Based on the jsPsych html-audio-response plugin.
 *
 * @author Teon, Becky, Josh
 * @see {@link /plugin-voice-response/README.md}}
 */
class VoiceResponsePlugin implements JsPsychPlugin<Info> {
  static info = info;
  private stimulus_start_time;
  private recorder_start_time;
  private recorder: MediaRecorder;
  private audio_url;
  private response;
  private load_resolver;
  private rt: number = null;
  private start_event_handler;
  private stop_event_handler;
  private data_available_handler;
  private recorded_data_chunks = [];
  private arrayBuffer;
  private data;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    this.recorder = this.jsPsych.pluginAPI.getMicrophoneRecorder();

    this.setupRecordingEvents(display_element, trial);

    this.startRecording();
  }

  private showDisplay(display_element, trial) {
    const ro = new ResizeObserver((entries, observer) => {
      this.stimulus_start_time = performance.now();
      observer.unobserve(display_element);
      //observer.disconnect();
    });

    ro.observe(display_element);

    let html = `<div id="jspsych-html-audio-response-stimulus">${trial.stimulus}</div>`;

    if (trial.show_done_button) {
      html += `<p><button class="jspsych-btn" id="finish-trial">${trial.done_button_label}</button></p>`;
    }

    display_element.innerHTML = html;
  }

  private hideStimulus(display_element: HTMLElement) {
    const el: HTMLElement = display_element.querySelector(
      "#jspsych-html-audio-response-stimulus"
    );
    if (el) {
      el.style.visibility = "hidden";
    }
  }

  private addButtonEvent(display_element, trial) {
    const btn = display_element.querySelector("#finish-trial");
    if (btn) {
      btn.addEventListener("click", () => {
        const end_time = performance.now();
        this.rt = Math.round(end_time - this.stimulus_start_time);
        this.stopRecording().then(() => {
          if (trial.allow_playback) {
            this.showPlaybackControls(display_element, trial);
          } else {
            this.endTrial(display_element, trial);
          }
        });
      });
    }
  }

  private setupRecordingEvents(display_element, trial) {
    this.data_available_handler = (e) => {
      if (e.data.size > 0) {
        this.recorded_data_chunks.push(e.data);
      }
    };

    this.stop_event_handler = () => {
      const data = new Blob(this.recorded_data_chunks, {
        type: this.recorded_data_chunks[0].type,
      });
      this.audio_url = URL.createObjectURL(data);
      if (trial.local_download) {
        const link = document.createElement("a");
        link.href = this.audio_url;
        const filename = `${trial.download_file_name}-${Date.now()}.wav`;
        link.download = filename;
        link.click();
        this.response = filename;
        this.load_resolver();
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const base64 = (reader.result as string).split(",")[1];
        this.response = base64;
        this.load_resolver();
      });
      reader.readAsDataURL(data);
      // loading the data
      const fileReader = new FileReader();
      // let arrayBuffer;
      this.data = data;
      fileReader.onloadend = () => {
        this.arrayBuffer = fileReader.result;
      };
      fileReader.readAsArrayBuffer(data);
    };

    this.start_event_handler = (e) => {
      // resets the recorded data
      this.recorded_data_chunks.length = 0;

      this.recorder_start_time = e.timeStamp;
      this.showDisplay(display_element, trial);
      this.addButtonEvent(display_element, trial);

      // setup timer for hiding the stimulus
      if (trial.stimulus_duration !== null) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          this.hideStimulus(display_element);
        }, trial.stimulus_duration);
      }

      // setup timer for ending the trial
      if (trial.recording_duration !== null) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          // this check is necessary for cases where the
          // done_button is clicked before the timer expires
          if (this.recorder.state !== "inactive") {
            this.stopRecording().then(() => {
              if (trial.allow_playback) {
                this.showPlaybackControls(display_element, trial);
              } else {
                this.endTrial(display_element, trial);
              }
            });
          }
        }, trial.recording_duration);
      }
    };

    this.recorder.addEventListener(
      "dataavailable",
      this.data_available_handler
    );

    this.recorder.addEventListener("stop", this.stop_event_handler);

    this.recorder.addEventListener("start", this.start_event_handler);
  }

  private startRecording() {
    this.recorder.start();
  }

  private stopRecording() {
    this.recorder.stop();
    return new Promise((resolve) => {
      this.load_resolver = resolve;
    });
  }

  private showPlaybackControls(display_element, trial) {
    display_element.innerHTML = `
      <p><audio id="playback" src="${this.audio_url}" controls></audio></p>
      <button id="record-again" class="jspsych-btn">${trial.record_again_button_label}</button>
      <button id="continue" class="jspsych-btn">${trial.accept_button_label}</button>
    `;

    display_element
      .querySelector("#record-again")
      .addEventListener("click", () => {
        // release object url to save memory
        URL.revokeObjectURL(this.audio_url);
        this.startRecording();
      });
    display_element.querySelector("#continue").addEventListener("click", () => {
      this.endTrial(display_element, trial);
    });

    // const audio = display_element.querySelector('#playback');
    // audio.src =
  }

  private endTrial(display_element, trial) {
    // clear recordering event handler

    this.recorder.removeEventListener(
      "dataavailable",
      this.data_available_handler
    );
    this.recorder.removeEventListener("start", this.start_event_handler);
    this.recorder.removeEventListener("stop", this.stop_event_handler);

    // gather the data to store for the trial
    var trial_data: any = {
      rt: this.rt,
      stimulus: trial.stimulus,
      response: this.response,
      estimated_stimulus_onset: Math.round(
        this.stimulus_start_time - this.recorder_start_time
      ),
    };

    if (trial.save_audio_url) {
      trial_data.audio_url = this.audio_url;
    } else {
      URL.revokeObjectURL(this.audio_url);
    }

    // move on to the next trial
    this.jsPsych.finishTrial(trial_data);
    transcribe(trial_data.audio_url, this.arrayBuffer, this.data);
  }
}

async function transcribe(audio_url, arrayBuffer, data) {
  // huggingface
  const transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en"
  );
  // const output = await transcriber("https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav");

  async function dataURLtoArrayBuffer(audio_url) {
    const response = await fetch(audio_url).then((x) => x.arrayBuffer());
    const arrayBuffer = new Uint8Array(response);

    return arrayBuffer;
  }

  // dataURL way
  // const wav = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav"
  const wav = "http://localhost:8000/examples/audio-response-1747257891581.wav";
  const dataArrayBuffer = await dataURLtoArrayBuffer(audio_url);

  // AudioContext

  // const setAudioFromRecording = async (data: Blob) => {

  //       const fileReader = new FileReader();
  //       fileReader.onloadend = async () => {
  //           const audioCTX = new AudioContext({
  //               sampleRate:  16000,  //determined by whisper-tiny, figure this out later
  //           });
  //           const arrayBuffer = fileReader.result as ArrayBuffer;
  //           const decoded = await audioCTX.decodeAudioData(arrayBuffer);
  //           setAudioData({
  //               buffer: decoded,
  //               url: blobUrl,
  //               source: AudioSource.RECORDING,
  //               mimeType: data.type,
  //           });
  //       };
  //       fileReader.readAsArrayBuffer(data);
  //   };

  // let wav = new WaveFile(dataArrayBuffer);
  // wav.toBitDepth('32f');
  // wav.toSampleRate(16000);
  // let audioData = wav.getSamples();

  // if (Array.isArray(audioData)) {
  //   if (audioData.length > 1) {
  //     const SCALING_FACTOR = Math.sqrt(2);

  //     // Merge channels (into first channel to save memory)
  //     for (let i = 0; i < audioData[0].length; ++i) {
  //       audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
  //     }
  //   }

  //   // Select first channel
  //   audioData = audioData[0];
  // }

  // const count = dataArrayBuffer.byteLength / 4;
  // const audioArray = new Float32Array(dataArrayBuffer, 0, count);

  // data way
  // const dataAudioArray = new Float32Array(data, 0, count);

  // const end = audioArray.length - (audioArray.length % 4);
  // const trimmedAudioArray = new Float32Array(audioArray.slice(0, end));

  // console.log(dataArrayBuffer)
  // console.log(audioArray)
  // console.log(data)
  const output = await transcriber(wav, { return_timestamps: "word" });
  // const output = await transcriber(dataAudioArray);

  console.log(output);
}

export default VoiceResponsePlugin;
