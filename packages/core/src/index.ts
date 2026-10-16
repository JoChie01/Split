/**
 * index.ts
 *
 * WHAT: The front door of the core package. Other code (the API, the web app)
 *       imports everything from here instead of reaching into each file.
 *       Example: import { splitEqual, computeBalances } from "@split/core";
 */
export * from "./money";
export * from "./split";
export * from "./balances";
export * from "./settle";