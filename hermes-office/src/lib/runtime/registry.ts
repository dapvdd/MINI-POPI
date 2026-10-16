import type { RuntimeAdapter } from "./adapter";
import type { RuntimeId } from "./types";

export class RuntimeRegistry implements RuntimeRegistry {
  private adapters = new Map<RuntimeId, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: RuntimeId): RuntimeAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  all(): RuntimeAdapter[] {
    return Array.from(this.adapters.values());
  }
}

let globalRegistry: RuntimeRegistry | null = null;

export function getRuntimeRegistry(): RuntimeRegistry {
  if (!globalRegistry) {
    globalRegistry = new RuntimeRegistry();
  }
  return globalRegistry;
}
