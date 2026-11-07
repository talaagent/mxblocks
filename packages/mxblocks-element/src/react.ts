// Element Web puts its React on window before loading modules (module API
// contract); reuse it instead of bundling a second copy.
import type * as ReactNS from "react";

export const React: typeof ReactNS = (window as unknown as { React: typeof ReactNS }).React;
