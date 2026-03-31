import type { SpotlightCardData } from "@stream-team/shared";

type Subscriber = (event: SpotlightCardData) => void;

export class RealtimeBroker {
  private readonly byBroadcaster = new Map<string, Set<Subscriber>>();

  subscribe(broadcasterId: string, subscriber: Subscriber): () => void {
    const current = this.byBroadcaster.get(broadcasterId) ?? new Set<Subscriber>();
    current.add(subscriber);
    this.byBroadcaster.set(broadcasterId, current);

    return () => {
      const set = this.byBroadcaster.get(broadcasterId);
      if (!set) {
        return;
      }
      set.delete(subscriber);
      if (set.size === 0) {
        this.byBroadcaster.delete(broadcasterId);
      }
    };
  }

  publish(broadcasterId: string, event: SpotlightCardData): void {
    const subscribers = this.byBroadcaster.get(broadcasterId);
    if (!subscribers) {
      return;
    }
    for (const subscriber of subscribers) {
      subscriber(event);
    }
  }
}
