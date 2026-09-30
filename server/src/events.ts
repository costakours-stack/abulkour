import { EventEmitter } from "node:events";
import type { AlertEvent, PredictionRecord, Quote, StoredArticle } from "./domain/types.js";

export interface AppEvents {
  quote: [Quote];
  "article:new": [StoredArticle];
  "article:analyzed": [StoredArticle];
  prediction: [PredictionRecord];
  alert: [AlertEvent];
}

/** In-process event bus connecting market data, news, predictions, alerts and WebSockets. */
export class EventBus extends EventEmitter<AppEvents> {}
