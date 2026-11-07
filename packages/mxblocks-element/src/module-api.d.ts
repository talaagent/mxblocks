// Minimal types for the Element Web module API (engine 2.x), covering only
// what index.tsx uses. Written from the API's documented shape so this
// package needs no dependency on Element's own typings.

import type { JSX } from "react";

/** A read-only snapshot of a timeline event, as the module API passes it. */
export interface MatrixEvent {
  readonly eventId: string;
  readonly roomId: string;
  readonly sender: string;
  readonly type: string;
  /** The current (edited) content. */
  readonly content: Record<string, unknown>;
}

export interface CustomMessageRenderProps {
  mxEvent: MatrixEvent;
}

/** Returns Element's own rendering of the tile. */
export type OriginalMessageComponent = () => JSX.Element;

export interface CustomComponentsApi {
  /** The first renderer whose filter matches an event draws its tile. */
  registerMessageRenderer(
    eventTypeOrFilter: string | ((ev: MatrixEvent) => boolean),
    renderer: (
      props: CustomMessageRenderProps,
      originalComponent?: OriginalMessageComponent,
    ) => JSX.Element,
  ): void;
}

export interface ConfigApi {
  /** Element's whole config.json object. */
  get(): unknown;
}

export interface Api {
  readonly config: ConfigApi;
  readonly customComponents: CustomComponentsApi;
}

export interface Module {
  load(): Promise<void>;
}

/** The default export of a module: a class Element constructs with its Api. */
export interface ModuleFactory {
  /** A semver range the engine's version must satisfy. */
  readonly moduleApiVersion: string;
  new (api: Api): Module;
  readonly prototype: Module;
}
