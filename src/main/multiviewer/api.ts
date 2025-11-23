import log from "electron-log";
import fetch from "cross-fetch";
import { isEqual } from "lodash";
import {
  IRaceControlMessages,
  ISessionData,
  ISessionInfo,
  ISessionStatus,
  ITimingData,
  ITimingStats,
  ITrackStatus,
  RaceControlMessageSubCategory,
} from "../../shared/multiviewer/graphql_api_types";
import { getConfig } from "../ipc/config";
import {
  EventType,
  eventTypeReadableMap,
  DriverAudioEventType,
} from "../../shared/config/config_types";
import { eventHandler } from "../lightController/eventHandler";
import { handleDriverAudioEvent } from "../sounds/driverAudio";

export interface ILiveTimingData {
  RaceControlMessages: IRaceControlMessages | undefined;
  SessionData: ISessionData;
  SessionInfo: ISessionInfo;
  SessionStatus: ISessionStatus;
  TimingData: ITimingData;
  TimingStats: ITimingStats;
  TrackStatus: ITrackStatus;
}

let errorCheck: boolean = false;
export let liveTimingState: ILiveTimingData | undefined = undefined;
let currentFastestLapTimeSeconds: number | undefined = undefined;
let currentQualifyingPart: number | undefined = undefined;
let previousTrackStatus: ITrackStatus | undefined = undefined;
let previousSessionStatus: ISessionStatus | undefined = undefined;
let previousTimingDataLines: ITimingData["Lines"] | undefined = undefined;
let previousSessionKey: number | undefined = undefined;
let processedRaceControlMessages: IRaceControlMessages = {
  Messages: [],
};

export async function fetchMultiViewerLiveTimingData(): Promise<
  ILiveTimingData | undefined
> {
  try {
    const config = await getConfig();
    const graphqlUrl = new URL("/api/graphql", config.multiviewerLiveTimingURL);

    const response = await fetch(graphqlUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: /* GraphQL */ `
          query QueryAllLiveTimingData {
            f1LiveTimingState {
              RaceControlMessages
              SessionData
              SessionInfo
              SessionStatus
              TimingData
              TimingStats
              TrackStatus
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      if (!errorCheck) {
        errorCheck = true;
        log.warn(
          "MultiViewer GrahpQL API call failed! Error: " + response.statusText,
        );
      }
    }

    const json = await response.json();
    if (!json.data.f1LiveTimingState) return;

    return json.data.f1LiveTimingState;
  } catch (error: any) {
    if (!errorCheck) {
      errorCheck = true;
      log.warn("MultiViewer GrahpQL API call failed! Error: " + error.message);
    }
  }
}

export async function checkMultiViewerAPIStatus() {
  const config = await getConfig();
  const heartbeatUrl = new URL(
    "/api/v1/live-timing/Heartbeat",
    config.multiviewerLiveTimingURL,
  );

  try {
    const response = await fetch(heartbeatUrl.toString(), { method: "GET" });
    const json = await response.json();

    if (json.error !== "No data found, do you have live timing running?") {
      log.debug("MultiViewer API is online.");
      return true;
    } else {
      log.debug("MultiViewer API is offline.");
      return false;
    }
  } catch (error) {
    return false;
  }
}

export function parseLapTime(lapTime: string) {
  const [minutes, seconds, milliseconds] = lapTime
    .split(/[:.]/)
    .map((number) => parseInt(number.replace(/^0+/, "") || "0", 10));

  if (milliseconds === undefined) {
    return minutes + seconds / 1000;
  }

  return minutes * 60 + seconds + milliseconds / 1000;
}

function checkForNewFastestLap(
  _TimingStats: ITimingStats["Lines"],
  TimingData: ITimingData["Lines"],
) {
  const fastestLap = Object.entries(TimingData ?? {})
    .map(([driverNumber, line]) => {
      if (line.KnockedOut === true) return undefined;
      if (line.Retired === true) return undefined;
      if (line.Stopped === true) return undefined;

      const lapTime = line.BestLapTime?.Value;
      if (!lapTime) return undefined;
      return { driverNumber, lapTime, parsed: parseLapTime(lapTime) };
    })
    .filter(
      (
        entry,
      ): entry is { driverNumber: string; lapTime: string; parsed: number } =>
        entry !== undefined,
    )
    .sort((a, b) => a.parsed - b.parsed)[0];

  if (!fastestLap) return;

  const fastestLapTimeSeconds = fastestLap.parsed;

  if (
    typeof currentFastestLapTimeSeconds === "number" &&
    fastestLapTimeSeconds >= currentFastestLapTimeSeconds
  ) {
    return;
  }

  if (typeof currentFastestLapTimeSeconds === "number") {
    currentFastestLapTimeSeconds = fastestLapTimeSeconds;
    handleDriverAudioEvent({
      driverNumber: fastestLap.driverNumber,
      eventType: DriverAudioEventType.FastestLap,
    }).catch((error) =>
      log.warn(
        `Failed to play driver sound for ${fastestLap.driverNumber}`,
        error,
      ),
    );
    newEventHandler(EventType.FastestLap);
  } else {
    currentFastestLapTimeSeconds = fastestLapTimeSeconds;
  }
}

function checkForTrackStatusChange(
  TrackStatus: ITrackStatus,
  previousTrackStatus: ITrackStatus | undefined,
  SessionStatus: ISessionStatus,
  previousSessionStatus: ISessionStatus | undefined,
) {
  if (
    previousTrackStatus?.Status !== TrackStatus.Status &&
    SessionStatus.Status !== "Ends" &&
    SessionStatus.Status !== "Finalised"
  ) {
    switch (TrackStatus.Status) {
      case "1":
        newEventHandler(EventType.GreenFlag);
        break;
      case "2":
        newEventHandler(EventType.YellowFlag);
        break;
      case "4":
        newEventHandler(EventType.SafetyCar);
        break;
      case "5":
        newEventHandler(EventType.RedFlag);
        break;
      case "6":
        newEventHandler(EventType.VirtualSafetyCar);
        break;
      case "7":
        newEventHandler(EventType.VirtualSafetyCarEnding);
        break;
    }
  } else if (
    (SessionStatus.Status === "Ends" || SessionStatus.Status === "Finalised") &&
    previousSessionStatus?.Status !== SessionStatus.Status
  ) {
    newEventHandler(EventType.SessionEnded);
  }
}

function checkForDriverPositionGain(TimingData: ITimingData["Lines"]) {
  if (!TimingData) return;

  if (!previousTimingDataLines) {
    previousTimingDataLines = TimingData;
    return;
  }

  Object.entries(TimingData).forEach(([driverNumber, line]) => {
    const previousLine = previousTimingDataLines?.[driverNumber];
    if (!previousLine) return;

    const previousPosition = parseInt(previousLine.Position, 10);
    const currentPosition = parseInt(line.Position, 10);

    if (Number.isNaN(previousPosition) || Number.isNaN(currentPosition)) return;

    if (currentPosition < previousPosition) {
      handleDriverAudioEvent({
        driverNumber,
        eventType: DriverAudioEventType.PositionGain,
      }).catch((error) =>
        log.warn(`Failed to play driver sound for ${driverNumber}`, error),
      );
    }
  });

  previousTimingDataLines = TimingData;
}

function checkForNewEventsInRaceControlMessages(
  RaceControlMessages: IRaceControlMessages | undefined,
) {
  if (!RaceControlMessages || !RaceControlMessages.Messages) return;

  if (
    processedRaceControlMessages.Messages.length === 0 &&
    RaceControlMessages.Messages.length > 0
  ) {
    processedRaceControlMessages = RaceControlMessages;
    return;
  }

  if (
    RaceControlMessages.Messages.length ===
    processedRaceControlMessages.Messages.length
  ) {
    return;
  }

  const newMessages = RaceControlMessages.Messages.filter(
    (message) =>
      !processedRaceControlMessages.Messages.find((m) => isEqual(m, message)),
  );

  if (!newMessages.length) return;

  const lastMessage = newMessages[newMessages.length - 1];

  if (lastMessage.Message.match(/CHEQUERED FLAG/i)) {
    newEventHandler(EventType.ChequeredFlag);
  }
  if (lastMessage.Message.match(/BLUE FLAG/i)) {
    newEventHandler(EventType.BlueFlag);
  }
  if (lastMessage.Message.match(/DRS ENABLED/i)) {
    newEventHandler(EventType.DrsEnabled);
  }
  if (lastMessage.Message.match(/DRS DISABLED/i)) {
    newEventHandler(EventType.DrsDisabled);
  }
  if (lastMessage.Message.match(/PIT LANE ENTRY CLOSED/i)) {
    newEventHandler(EventType.PitLaneEntryClosed);
  }
  if (lastMessage.Message.match(/PIT EXIT OPEN/i)) {
    newEventHandler(EventType.PitExitOpen);
  }
  if (lastMessage.Message.match(/PIT ENTRY CLOSED/i)) {
    newEventHandler(EventType.PitEntryClosed);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.TimePenalty) {
    newEventHandler(EventType.TimePenalty);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.SessionStartDelayed
  ) {
    newEventHandler(EventType.SessionStartDelayed);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.SessionDurationChanged
  ) {
    newEventHandler(EventType.SessionDurationChanged);
  }
  if (
    lastMessage.SubCategory === RaceControlMessageSubCategory.LapTimeDeleted
  ) {
    newEventHandler(EventType.LapTimeDeleted);
  }
  if (
    lastMessage.SubCategory === RaceControlMessageSubCategory.LapTimeReinstated
  ) {
    newEventHandler(EventType.LapTimeReinstated);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.LappedCarsMayOvertake
  ) {
    newEventHandler(EventType.LappedCarsMayOvertake);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.LappedCarsMayNotOvertake
  ) {
    newEventHandler(EventType.LappedCarsMayNotOvertake);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.NormalGripConditions
  ) {
    newEventHandler(EventType.NormalGripConditions);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.OffTrackAndContinued
  ) {
    newEventHandler(EventType.OffTrackAndContinued);
  }
  if (
    lastMessage.SubCategory === RaceControlMessageSubCategory.SpunAndContinued
  ) {
    newEventHandler(EventType.SpunAndContinued);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.MissedApex) {
    newEventHandler(EventType.MissedApex);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.CarStopped) {
    newEventHandler(EventType.CarStopped);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.MedicalCar) {
    newEventHandler(EventType.MedicalCar);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.IncidentNoted) {
    newEventHandler(EventType.IncidentNoted);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.IncidentUnderInvestigation
  ) {
    newEventHandler(EventType.IncidentUnderInvestigation);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.IncidentInvestigationAfterSession
  ) {
    newEventHandler(EventType.IncidentInvestigationAfterSession);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.IncidentNoFurtherAction
  ) {
    newEventHandler(EventType.IncidentNoFurtherAction);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.IncidentNoFurtherInvestigation
  ) {
    newEventHandler(EventType.IncidentNoFurtherInvestigation);
  }
  if (lastMessage.SubCategory === RaceControlMessageSubCategory.StopGoPenalty) {
    newEventHandler(EventType.StopGoPenalty);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.TrackSurfaceSlippery
  ) {
    newEventHandler(EventType.TrackSurfaceSlippery);
  }
  if (
    lastMessage.SubCategory === RaceControlMessageSubCategory.LowGripConditions
  ) {
    newEventHandler(EventType.LowGripConditions);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.SessionStartAborted
  ) {
    newEventHandler(EventType.SessionStartAborted);
  }
  if (
    lastMessage.SubCategory ===
    RaceControlMessageSubCategory.DriveThroughPenalty
  ) {
    newEventHandler(EventType.DriveThroughPenalty);
  }

  processedRaceControlMessages = RaceControlMessages;
}

function checkForNewQualifyingPart() {
  if (liveTimingState?.SessionInfo.Type !== "Qualifying") return;

  const qualifyingPart = liveTimingState?.SessionData.Series
    ? liveTimingState?.SessionData.Series[
        liveTimingState?.SessionData.Series.length - 1
      ]?.QualifyingPart
    : null;

  if (qualifyingPart === null) return;

  if (currentQualifyingPart !== qualifyingPart) {
    if (typeof currentQualifyingPart !== "undefined") {
      currentFastestLapTimeSeconds = 3600;
    }
    currentQualifyingPart = qualifyingPart;
  }
}

export function startLiveTimingDataPolling() {
  setInterval(async () => {
    const liveTimingData = await fetchMultiViewerLiveTimingData();
    if (!liveTimingData) return;

    if (previousSessionKey !== liveTimingData.SessionInfo.Key) {
      previousSessionKey = liveTimingData.SessionInfo.Key;
      previousTimingDataLines = undefined;
      currentFastestLapTimeSeconds = undefined;
      currentQualifyingPart = undefined;
      processedRaceControlMessages = { Messages: [] };
      previousTrackStatus = undefined;
      previousSessionStatus = undefined;
    }
    liveTimingState = liveTimingData;

    checkForNewQualifyingPart();
    checkForNewFastestLap(
      liveTimingData.TimingStats.Lines,
      liveTimingData.TimingData.Lines,
    );
    checkForTrackStatusChange(
      liveTimingData.TrackStatus,
      previousTrackStatus,
      liveTimingData.SessionStatus,
      previousSessionStatus,
    );
    checkForDriverPositionGain(liveTimingData.TimingData.Lines);
    checkForNewEventsInRaceControlMessages(liveTimingData.RaceControlMessages);
  }, 500);
}

function newEventHandler(event: EventType) {
  eventHandler(event);
  log.info("New event: ", eventTypeReadableMap[event]);
  previousTrackStatus = liveTimingState?.TrackStatus;
  previousSessionStatus = liveTimingState?.SessionStatus;
}
