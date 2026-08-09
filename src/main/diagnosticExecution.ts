import { createHash, randomUUID } from "node:crypto";
import { JAVASCRIPT_DIAGNOSTIC_PLAN_TTL_MS, type JavaScriptDiagnosticIntent } from "../shared/javascriptDiagnostics.js";

export type DiagnosticExecutionPlanInput = Readonly<{
  code: string;
  codeDigest: string;
  elementId: string;
  localElementId: string;
  snapshotToken: string;
  sessionId: string;
  sessionRevision: number;
  intent: JavaScriptDiagnosticIntent;
}>;

export type StoredDiagnosticExecutionPlan = Readonly<DiagnosticExecutionPlanInput & {
  executionId: string;
  expiresAt: string;
}>;

type StoredPlanEntry = {
  plan: StoredDiagnosticExecutionPlan;
  expiresAtMs: number;
};

function copyPlan(plan: StoredDiagnosticExecutionPlan): StoredDiagnosticExecutionPlan {
  return Object.freeze({ ...plan });
}

export class DiagnosticExecutionPlanStore {
  private readonly plans = new Map<string, StoredPlanEntry>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly ttlMs: number;
  private readonly maxPlans: number;

  constructor(options: { now?: () => number; createId?: () => string; ttlMs?: number; maxPlans?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.ttlMs = options.ttlMs ?? JAVASCRIPT_DIAGNOSTIC_PLAN_TTL_MS;
    this.maxPlans = options.maxPlans ?? 1_000;
  }

  create(input: DiagnosticExecutionPlanInput): StoredDiagnosticExecutionPlan {
    const now = this.now();
    this.deleteExpired(now);
    const expiresAtMs = now + this.ttlMs;
    const plan = Object.freeze({
      ...input,
      executionId: this.createId(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
    this.plans.delete(plan.executionId);
    while (this.plans.size >= this.maxPlans) {
      const oldestExecutionId = this.plans.keys().next().value;
      if (oldestExecutionId === undefined) break;
      this.plans.delete(oldestExecutionId);
    }
    this.plans.set(plan.executionId, { plan, expiresAtMs });
    return copyPlan(plan);
  }

  consume(executionId: string):
    | { status: "ready"; plan: StoredDiagnosticExecutionPlan }
    | { status: "missing" }
    | { status: "expired" } {
    const now = this.now();
    const entry = this.plans.get(executionId);
    this.deleteExpired(now, executionId);
    this.plans.delete(executionId);
    if (!entry) return { status: "missing" };
    if (now >= entry.expiresAtMs) return { status: "expired" };
    return { status: "ready", plan: copyPlan(entry.plan) };
  }

  clear(): void {
    this.plans.clear();
  }

  private deleteExpired(now: number, exceptExecutionId?: string): void {
    for (const [executionId, entry] of this.plans) {
      if (executionId !== exceptExecutionId && now >= entry.expiresAtMs) this.plans.delete(executionId);
    }
  }
}

export function digestDiagnosticCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function buildDiagnosticRuntimeExpression(_input: {
  code: string;
  localElementId: string;
  snapshotToken: string;
}): string {
  const code = JSON.stringify(_input.code);
  const localElementId = JSON.stringify(_input.localElementId);
  const snapshotToken = JSON.stringify(_input.snapshotToken);
  return `(async () => {
  const expectedSnapshotToken = ${snapshotToken};
  const localElementId = ${localElementId};
  const source = ${code};
  const maxDepth = 5;
  const maxEntries = 100;
  const maxStringCharacters = 20_000;
  const maxTotalCharacters = 100_000;
  const SafeError = Error;
  const SafeFunction = Function;
  const SafeWeakSet = WeakSet;
  const safeString = String;
  const arrayIsArray = Array.isArray.bind(Array);
  const jsonStringify = JSON.stringify.bind(JSON);
  const numberIsFinite = Number.isFinite.bind(Number);
  const objectCreate = Object.create.bind(Object);
  const objectKeys = Object.keys.bind(Object);
  const objectValues = Object.values.bind(Object);
  const mathFloor = Math.floor.bind(Math);
  const mathMin = Math.min.bind(Math);
  const arrayPop = Function.call.bind(Array.prototype.pop);
  const arrayPush = Function.call.bind(Array.prototype.push);
  const arraySlice = Function.call.bind(Array.prototype.slice);
  const arraySome = Function.call.bind(Array.prototype.some);
  const stringSlice = Function.call.bind(String.prototype.slice);
  const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
  const weakSetDelete = Function.call.bind(WeakSet.prototype.delete);
  const weakSetHas = Function.call.bind(WeakSet.prototype.has);
  let remainingCharacters = maxTotalCharacters;

  const messageFor = (error) => {
    try {
      return error instanceof SafeError ? error.message : safeString(error);
    } catch {
      return "Unknown error";
    }
  };

  const read = (value, key, fallback) => {
    try {
      return value[key];
    } catch (error) {
      return fallback + messageFor(error) + "]";
    }
  };

  const takeText = (value, characterLimit = maxStringCharacters) => {
    let text;
    try {
      text = safeString(value);
    } catch (error) {
      text = "[Unprintable: " + messageFor(error) + "]";
    }
    const available = mathMin(characterLimit, maxStringCharacters, remainingCharacters);
    const truncated = text.length > available;
    const result = stringSlice(text, 0, available);
    remainingCharacters -= result.length;
    return { value: result, truncated };
  };

  const jsonLength = (value) => {
    try {
      return jsonStringify(value).length;
    } catch {
      return maxTotalCharacters + 1;
    }
  };

  const shrinkSerializedValue = (value) => {
    if (!value || typeof value !== "object") return false;
    if (arrayIsArray(value.value)) {
      if (value.value.length === 0) return false;
      arrayPop(value.value);
      value.truncated = true;
      return true;
    }
    if (value.kind === "object" && value.value && typeof value.value === "object") {
      const keys = objectKeys(value.value);
      const lastKey = keys[keys.length - 1];
      if (lastKey === undefined) return false;
      delete value.value[lastKey];
      value.truncated = true;
      return true;
    }
    for (const field of ["value", "text", "className", "id", "tagName"]) {
      if (typeof value[field] !== "string" || value[field].length === 0) continue;
      value[field] = stringSlice(value[field], 0, mathFloor(value[field].length / 2));
      value.truncated = true;
      return true;
    }
    return false;
  };

  const finalize = (result) => {
    if (result.status === "success") {
      while (jsonLength(result) > maxTotalCharacters && shrinkSerializedValue(result.value)) {
        // The serialized structure is reduced until its complete JSON representation fits.
      }
      if (jsonLength(result) <= maxTotalCharacters) return result;
      return { status: "success", value: { kind: "truncated", value: "[Serialization limit]", truncated: true } };
    }
    if (result.status === "exception") {
      while (jsonLength(result) > maxTotalCharacters) {
        if (typeof result.stack === "string" && result.stack.length > 0) {
          result.stack = result.stack.slice(0, Math.floor(result.stack.length / 2));
          continue;
        }
        if (typeof result.message === "string" && result.message.length > 0) {
          result.message = result.message.slice(0, Math.floor(result.message.length / 2));
          continue;
        }
        return { status: "exception", message: "Runtime exception exceeded serialization limit." };
      }
    }
    return result;
  };

  const isDomNode = (value) => {
    if (!value || typeof value !== "object") return false;
    try {
      return typeof value.nodeType === "number" && typeof value.tagName === "string";
    } catch {
      return false;
    }
  };

  const serialize = (value, depth, seen) => {
    if (value === undefined) return { kind: "undefined" };
    if (value === null) return { kind: "null" };

    const valueType = typeof value;
    if (valueType === "boolean") return { kind: "boolean", value };
    if (valueType === "number") return { kind: "number", value: numberIsFinite(value) ? value : safeString(value) };
    if (valueType === "string") {
      const text = takeText(value);
      return { kind: "string", value: text.value, truncated: text.truncated };
    }
    if (valueType === "bigint" || valueType === "symbol" || valueType === "function") {
      const text = takeText(valueType === "function" ? value.name || "anonymous" : value);
      return { kind: valueType, value: text.value };
    }

    if (isDomNode(value)) {
      const tagName = takeText(read(value, "tagName", "[Property threw: "));
      const id = takeText(read(value, "id", "[Property threw: ") ?? "");
      const className = takeText(read(value, "className", "[Property threw: ") ?? "");
      const text = takeText(read(value, "textContent", "[Property threw: ") ?? "", 200);
      return {
        kind: "dom-node",
        tagName: tagName.value,
        id: id.value,
        className: className.value,
        text: text.value
      };
    }

    const array = arrayIsArray(value);
    if (depth >= maxDepth) {
      return { kind: array ? "array" : "object", value: "[Max depth]", truncated: true };
    }
    if (weakSetHas(seen, value)) return "[Circular]";
    weakSetAdd(seen, value);

    let keys;
    try {
      if (array) {
        const entryCount = mathMin(value.length, maxEntries);
        keys = [];
        for (let index = 0; index < entryCount; index += 1) arrayPush(keys, safeString(index));
      } else {
        keys = objectKeys(value);
      }
    } catch (error) {
      return {
        kind: array ? "array" : "object",
        value: "[Serialization failed: " + messageFor(error) + "]",
        truncated: true
      };
    }

    const limitedKeys = array ? keys : arraySlice(keys, 0, maxEntries);
    const truncated = array ? value.length > maxEntries : keys.length > maxEntries;
    if (array) {
      const entries = [];
      for (const key of limitedKeys) {
        let entry;
        try {
          entry = value[key];
        } catch (error) {
          entry = "[Accessor threw: " + messageFor(error) + "]";
        }
        arrayPush(entries, serialize(entry, depth + 1, seen));
      }
      const result = {
        kind: "array",
        value: entries,
        truncated: truncated || arraySome(entries, (entry) => entry?.truncated)
      };
      weakSetDelete(seen, value);
      return result;
    }

    const entries = objectCreate(null);
    for (const key of limitedKeys) {
      const outputKey = takeText(key).value;
      let entry;
      try {
        entry = value[key];
      } catch (error) {
        entry = "[Accessor threw: " + messageFor(error) + "]";
      }
      entries[outputKey] = serialize(entry, depth + 1, seen);
    }
    const result = {
      kind: "object",
      value: entries,
      truncated: truncated || arraySome(objectValues(entries), (entry) => entry?.truncated)
    };
    weakSetDelete(seen, value);
    return result;
  };

  if (window.__uiExplorerSnapshotToken !== expectedSnapshotToken) {
    return finalize({ status: "stale-target", message: "The selected snapshot is no longer current." });
  }
  const target = window.__uiExplorerElements?.get(localElementId);
  if (!target || !target.isConnected) {
    return finalize({ status: "stale-target", message: "The selected target is no longer available." });
  }

  try {
    const execute = new SafeFunction("$target", "return (async () => {\\n" + source + "\\n})();");
    const value = await execute(target);
    return finalize({ status: "success", value: serialize(value, 0, new SafeWeakSet()) });
  } catch (error) {
    const message = takeText(messageFor(error)).value;
    let stack;
    try {
      stack = typeof error?.stack === "string" ? takeText(error.stack).value : undefined;
    } catch {
      stack = undefined;
    }
    return finalize({ status: "exception", message, ...(stack ? { stack } : {}) });
  }
})()`;
}

export function isRuntimeTimeoutError(error: unknown): boolean {
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return /timed out|timeout|execution was terminated/i.test(message);
}
