import React, { useCallback, useMemo } from "react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  FormGroup,
  InputAdornment,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { DeleteRounded, PlayArrowRounded } from "@mui/icons-material";
import {
  DriverAudioAlert,
  DriverAudioEventType,
  driverAudioEventReadableMap,
} from "../../../shared/config/config_types";
import { useConfig } from "../../hooks/useConfig";

export function DriverAudioSettings() {
  const { config, updateConfig } = useConfig();
  const alerts = useMemo(
    () => config.driverAudioAlerts ?? [],
    [config.driverAudioAlerts],
  );

  const saveAlerts = useCallback(
    (newAlerts: DriverAudioAlert[]) => {
      updateConfig({ driverAudioAlerts: newAlerts });
    },
    [updateConfig],
  );

  const handleAddAlert = useCallback(() => {
    const newAlert: DriverAudioAlert = {
      id: Date.now(),
      driverNumber: "",
      driverName: "",
      events: [DriverAudioEventType.FastestLap],
      enabled: true,
    };

    saveAlerts([...alerts, newAlert]);
  }, [alerts, saveAlerts]);

  const handleDeleteAlert = useCallback(
    (id: number) => {
      saveAlerts(alerts.filter((alert) => alert.id !== id));
    },
    [alerts, saveAlerts],
  );

  const handleUpdateAlert = useCallback(
    (id: number, patch: Partial<DriverAudioAlert>) => {
      const updatedAlerts = alerts.map((alert) =>
        alert.id === id ? { ...alert, ...patch } : alert,
      );
      saveAlerts(updatedAlerts);
    },
    [alerts, saveAlerts],
  );

  const handleUpdateSoundPath = useCallback(
    (id: number, filePath?: string) => {
      handleUpdateAlert(id, { soundFilePath: filePath || undefined });
    },
    [handleUpdateAlert],
  );

  const handleToggleEvent = useCallback(
    (id: number, event: DriverAudioEventType) => {
      const updatedAlerts = alerts.map((alert) => {
        if (alert.id !== id) return alert;

        const hasEvent = alert.events.includes(event);
        return {
          ...alert,
          events: hasEvent
            ? alert.events.filter((existing) => existing !== event)
            : [...alert.events, event],
        };
      });

      saveAlerts(updatedAlerts);
    },
    [alerts, saveAlerts],
  );

  const handleSimulateAlert = useCallback((alert: DriverAudioAlert) => {
    const eventType = alert.events[0];
    const driverNumber = alert.driverNumber.trim();

    if (!eventType || !driverNumber) return;

    window.f1mvli.driverAudio.simulate({
      driverNumber,
      eventType,
    });
  }, []);

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      {alerts.map((alert) => (
        <Card key={alert.id} variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                alignItems={{ xs: "flex-start", sm: "center" }}
              >
                <TextField
                  label="Driver number"
                  value={alert.driverNumber}
                  onChange={(event) =>
                    handleUpdateAlert(alert.id, {
                      driverNumber: event.target.value,
                    })
                  }
                />
                <TextField
                  label="Driver label (optional)"
                  value={alert.driverName ?? ""}
                  onChange={(event) =>
                    handleUpdateAlert(alert.id, {
                      driverName: event.target.value,
                    })
                  }
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={alert.enabled}
                      onChange={(event) =>
                        handleUpdateAlert(alert.id, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                  }
                  label="Enabled"
                  sx={{ mr: { xs: 0, sm: 2 } }}
                />
                <IconButton
                  aria-label="Delete driver alert"
                  onClick={() => handleDeleteAlert(alert.id)}
                  size="small"
                  color="error"
                >
                  <DeleteRounded />
                </IconButton>
              </Stack>

              <FormGroup row>
                {Object.values(DriverAudioEventType).map((event) => (
                  <FormControlLabel
                    key={event}
                    control={
                      <Checkbox
                        checked={alert.events.includes(event)}
                        onChange={() => handleToggleEvent(alert.id, event)}
                      />
                    }
                    label={driverAudioEventReadableMap[event]}
                  />
                ))}
              </FormGroup>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                alignItems={{ xs: "stretch", sm: "center" }}
              >
                <TextField
                  fullWidth
                  label="Audio file (optional)"
                  placeholder="Select a sound file to play"
                  value={alert.soundFilePath ?? ""}
                  onChange={(event) =>
                    handleUpdateSoundPath(alert.id, event.target.value)
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Stack direction="row" spacing={1}>
                          <Button
                            component="label"
                            variant="outlined"
                            size="small"
                          >
                            Browse
                            <input
                              type="file"
                              accept="audio/*"
                              hidden
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                const filePath = (
                                  file as File & { path?: string }
                                )?.path;
                                handleUpdateSoundPath(alert.id, filePath);
                                event.target.value = "";
                              }}
                            />
                          </Button>
                          <Button
                            variant="text"
                            size="small"
                            onClick={() => handleUpdateSoundPath(alert.id)}
                            disabled={!alert.soundFilePath}
                          >
                            Clear
                          </Button>
                        </Stack>
                      </InputAdornment>
                    ),
                  }}
                />
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", sm: "center" }}
              >
                <Button
                  variant="outlined"
                  startIcon={<PlayArrowRounded />}
                  onClick={() => handleSimulateAlert(alert)}
                  disabled={
                    !alert.enabled ||
                    !alert.driverNumber.trim().length ||
                    !alert.events.length
                  }
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                >
                  Test alert
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Plays the first selected event for this driver.
                </Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}

      <Stack spacing={1}>
        {!alerts.length && (
          <Typography color="text.secondary">
            Add drivers to hear a sound when they set the fastest lap or gain a
            position.
          </Typography>
        )}
        <Button variant="outlined" onClick={handleAddAlert} sx={{ mr: "auto" }}>
          Add driver sound
        </Button>
      </Stack>
    </Stack>
  );
}
