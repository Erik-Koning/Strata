// A stand-in for the OpenCode plugin host, so the plugin can be driven without OpenCode.
// It implements the parts of `ctx` the plugin uses and records every hook it registers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createFakeHost({ directory, messages = [] } = {}) {
  const hooks = { session: {}, tool: {} };
  const transformations = { command: null, mcp: null, skill: null };
  const instructions = new Map();
  const instructionCalls = [];
  const synthetic = [];
  const subscribers = [];

  const register = (bag, name, callback) => {
    bag[name] = callback;
    return { dispose: async () => delete bag[name] };
  };

  const ctx = {
    location: { directory },
    session: {
      hook: (name, callback) => register(hooks.session, name, callback),
      context: async () => messages,
      instructions: {
        entry: {
          put: async ({ sessionID, key, value }) => {
            instructionCalls.push({ sessionID, key });
            instructions.set(key, value);
          },
          list: async () => [...instructions].map(([key, value]) => ({ key, value })),
          remove: async ({ key }) => instructions.delete(key),
        },
      },
      synthetic: async (input) => synthetic.push(input),
    },
    tool: { hook: (name, callback) => register(hooks.tool, name, callback) },
    command: {
      transform: async (callback) => {
        const added = [];
        callback({ add: (definition) => added.push(definition), list: () => [], get: () => undefined, remove() {} });
        transformations.command = added;
        return { dispose: async () => {} };
      },
    },
    mcp: {
      transform: async (callback) => {
        const servers = new Map();
        callback({ set: (name, config) => servers.set(name, config), list: () => [...servers], get: () => undefined });
        transformations.mcp = servers;
        return { dispose: async () => {} };
      },
    },
    skill: {
      transform: async (callback) => {
        const added = [];
        callback({ add: (skill) => added.push(skill), list: () => [], get: () => undefined, remove() {} });
        transformations.skill = added;
        return { dispose: async () => {} };
      },
    },
    event: {
      // The plugin opens more than one subscription; each gets its own queue.
      subscribe: async function* (options = {}) {
        const queue = [];
        let resolveNext;
        subscribers.push((event) => {
          queue.push(event);
          resolveNext?.();
        });
        while (!options.signal?.aborted) {
          if (!queue.length) await new Promise((resolve) => (resolveNext = resolve));
          while (queue.length) yield queue.shift();
        }
      },
    },
  };

  return {
    ctx,
    hooks,
    transformations,
    instructions,
    instructionCalls,
    synthetic,
    subscribers,
    /** Deliver an event to every subscription, as the server's event stream would. */
    emit: (event) => {
      for (const deliver of subscribers) deliver(event);
    },
  };
}

/** A temp STRATA_HOME so a test never touches the real ~/.strata. */
export function tempHome(prefix = "strata-opencode-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
