import type { SshHostSlot } from "../types.js";

/**
 * SSH host pool for distributing workers across remote hosts.
 */
export class SshPool {
  private readonly slots: Map<string, SshHostSlot> = new Map();

  constructor(hosts: string[], maxPerHost: number) {
    for (const host of hosts) {
      this.slots.set(host, {
        host,
        running_count: 0,
        max_concurrent: maxPerHost,
      });
    }
  }

  /**
   * Acquire a host with available capacity.
   * Prefers the given host (for retry affinity) if it has capacity.
   * Returns null if no host is available.
   */
  acquire(preferredHost?: string): string | null {
    // Try preferred host first
    if (preferredHost) {
      const slot = this.slots.get(preferredHost);
      if (slot && slot.running_count < slot.max_concurrent) {
        slot.running_count++;
        return slot.host;
      }
    }

    // Find any host with capacity
    for (const slot of this.slots.values()) {
      if (slot.running_count < slot.max_concurrent) {
        slot.running_count++;
        return slot.host;
      }
    }

    return null;
  }

  /**
   * Release a host slot.
   */
  release(host: string): void {
    const slot = this.slots.get(host);
    if (slot && slot.running_count > 0) {
      slot.running_count--;
    }
  }

  /**
   * Get total available slots across all hosts.
   */
  availableSlots(): number {
    let total = 0;
    for (const slot of this.slots.values()) {
      total += slot.max_concurrent - slot.running_count;
    }
    return total;
  }

  /**
   * Get all host statuses.
   */
  getStatus(): SshHostSlot[] {
    return Array.from(this.slots.values());
  }
}
