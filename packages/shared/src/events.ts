import type { SpotlightCardData } from "./types";

export interface SpotlightEvent {
  type: "spotlight.triggered";
  payload: SpotlightCardData;
}

export interface OverlayDismissedEvent {
  type: "spotlight.dismissed";
  eventId: string;
}

export type ExtensionRealtimeEvent = SpotlightEvent | OverlayDismissedEvent;
