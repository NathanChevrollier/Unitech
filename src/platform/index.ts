import type { Bridge } from "./bridge";
import { tauriBridge } from "./tauri";
import { webBridge } from "./web";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const bridge: Bridge = isDesktop ? tauriBridge : webBridge;
export type * from "./bridge";
