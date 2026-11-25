import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamHubVoiceCapture } from "@/features/teamhub/teamhub-types";
import { RecordingEntry } from "./recording-entry";
import {
  VoiceCapabilitiesContext,
  VoiceConnectionRetryContext,
  VoiceControlContext,
  type VoiceCaptureState,
  type VoiceControlContextValue,
} from "./voice-control-context";

const recordingWindow = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./recording-window-store", () => ({
  openRecordingWindow: recordingWindow.open,
}));
vi.mock("../chat/voice-mode/voice-pip", () => ({
  openVoicePip: async () => undefined,
  closeVoicePip: () => undefined,
}));

afterEach(cleanup);

function renderEntry(retryConnection?: () => void) {
  return render(
    <VoiceCapabilitiesContext value={undefined}>
      <VoiceConnectionRetryContext value={retryConnection}>
        <RecordingEntry
          anotherMeRoomId="another-me"
          tenantId="tenant-northstar"
        />
      </VoiceConnectionRetryContext>
    </VoiceCapabilitiesContext>,
  );
}

describe("RecordingEntry voice connection", () => {
  it("spins without offering a retry while voice connects", () => {
    renderEntry();
    const button = screen.getByRole("button", { name: "Meetings" });
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("retries a failed connection from the Meetings entry", () => {
    const retry = vi.fn();
    renderEntry(retry);
    const button = screen.getByRole("button", {
      name: "Retry voice connection",
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

const capture = {
  id: "capture-1",
  room_id: "another-me",
  voice_session_id: "voice-1",
  status: "recovering",
  created_at: "2026-11-22T08:00:00Z",
  updated_at: "2026-11-22T08:00:00Z",
  requested_start_offset_ms: 0,
  gap_count: 0,
  gap_duration_ms: 0,
  transcript_recovery_status: "running",
  transcript_recovery_progress_ms: 400,
  transcript_recovery_total_ms: 1000,
  transcript_recovery_attempt: 2,
  transcript_recovery_max_attempts: 8,
} as TeamHubVoiceCapture;

function renderWithVoice(
  captureState: VoiceCaptureState,
  extra: Partial<VoiceControlContextValue> = {},
) {
  const voice = {
    captureState,
    listenerStatus: "disabled",
    composerMicrophoneActive: false,
    selectTargetRoom: async () => undefined,
    ...extra,
  } as unknown as VoiceControlContextValue;
  return render(
    <VoiceControlContext value={voice}>
      <RecordingEntry
        anotherMeRoomId="another-me"
        tenantId="tenant-northstar"
      />
    </VoiceControlContext>,
  );
}

describe("RecordingEntry saving and recovery", () => {
  afterEach(() => recordingWindow.open.mockReset());

  it("shows the recovery attempt instead of spinning", () => {
    renderWithVoice({ capture, status: "recovering" });
    const button = screen.getByRole("button", { name: "View save progress" });
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(button).toHaveTextContent("Recovering 2/8");
    expect(button).toHaveAttribute(
      "title",
      "Recovering transcript (attempt 2 of 8)",
    );
  });

  it("shows the recovery progress from a TeamHub without attempts", () => {
    const { transcript_recovery_attempt: _attempt, ...older } = capture;
    renderWithVoice({ capture: older, status: "recovering" });
    const button = screen.getByRole("button", { name: "View save progress" });
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(button).toHaveAttribute("title", "Recovering transcript 40%");
  });

  it("opens a failed recovery without starting a recording", async () => {
    renderWithVoice({
      capture: { ...capture, transcript_recovery_status: "failed" },
      status: "recovering",
    });
    const button = screen.getByRole("button", { name: "Meetings" });
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(button).toHaveAttribute(
      "title",
      "Transcript recovery failed. Open to retry.",
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(recordingWindow.open).toHaveBeenCalledWith({ autoStart: false }),
    );
  });

  it("spins while saving and stops once Stop gave up", async () => {
    const recording = { ...capture, status: "recording" } as const;
    const { unmount } = renderWithVoice({
      capture: recording,
      status: "finalizing",
    });
    expect(
      screen
        .getByRole("button", { name: "View save progress" })
        .querySelector(".animate-spin"),
    ).not.toBeNull();
    unmount();
    renderWithVoice(
      { capture: recording, status: "finalizing" },
      { retryStop: async () => undefined },
    );
    const button = screen.getByRole("button", { name: "View save progress" });
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(button).toHaveAttribute(
      "title",
      "Couldn't save the recording. Open to retry.",
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(recordingWindow.open).toHaveBeenCalledWith({ autoStart: false }),
    );
  });
});
