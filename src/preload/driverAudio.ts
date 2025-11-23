import { ipcRenderer } from "electron";

import { DriverAudioEventOptions } from "../shared/sounds/driverAudio_types";

function simulate(options: DriverAudioEventOptions): Promise<void> {
  return ipcRenderer.invoke("f1mvli:driver-audio:simulate", options);
}

export const driverAudioAPI = {
  simulate,
};
