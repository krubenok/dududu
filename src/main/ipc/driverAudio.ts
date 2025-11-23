import { ipcMain } from "electron";

import { DriverAudioEventOptions } from "../../shared/sounds/driverAudio_types";
import { handleDriverAudioEvent } from "../sounds/driverAudio";

const handleSimulateDriverAudio = async (options: DriverAudioEventOptions) => {
  await handleDriverAudioEvent(options);
};

function registerDriverAudioIPCHandlers() {
  ipcMain.handle("f1mvli:driver-audio:simulate", (_, arg) => {
    return handleSimulateDriverAudio(arg);
  });

  return () => {
    ipcMain.removeHandler("f1mvli:driver-audio:simulate");
  };
}

export { registerDriverAudioIPCHandlers };
