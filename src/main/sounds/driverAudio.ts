import { shell } from "electron";
import log from "electron-log";
import { play as playSound } from "sound-play";
import { DriverAudioEventOptions } from "../../shared/sounds/driverAudio_types";
import { getConfig } from "../ipc/config";

export async function handleDriverAudioEvent({
  driverNumber,
  eventType,
}: DriverAudioEventOptions) {
  const config = await getConfig();
  const alerts = config.driverAudioAlerts ?? [];

  const matchingAlert = alerts.find(
    (alert) =>
      alert.enabled &&
      alert.driverNumber === driverNumber &&
      alert.events.includes(eventType),
  );

  if (!matchingAlert) return;

  const driverLabel = matchingAlert.driverName?.trim() || driverNumber;
  const soundFilePath = matchingAlert.soundFilePath?.trim();

  if (soundFilePath) {
    try {
      await playSound(soundFilePath);
      log.info(
        `Playing driver sound file for ${driverLabel} on ${eventType.toString()} event`,
      );
      return;
    } catch (error) {
      log.warn(
        `Failed to play driver sound file for ${driverLabel}: ${soundFilePath}`,
        error,
      );
    }
  }

  shell.beep();
  log.info(
    `Playing driver beep for ${driverLabel} on ${eventType.toString()} event`,
  );
}
