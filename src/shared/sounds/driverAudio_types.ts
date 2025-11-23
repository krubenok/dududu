import { DriverAudioEventType } from "../config/config_types";

export interface DriverAudioEventOptions {
  driverNumber: string;
  eventType: DriverAudioEventType;
}
