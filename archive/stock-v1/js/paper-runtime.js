/* Browser app PaperBroker wiring.
   Keeps product/runtime fee policy out of the domain broker constructor default. */
"use strict";

import { PaperBroker } from "./paper.js";
import { createPaperFeeModel } from "./paper-fee-model.js";

export function createAppPaperRuntime({ storage, feeModel = createPaperFeeModel(), ...brokerOptions } = {}) {
  const broker = new PaperBroker({ storage, feeModel, ...brokerOptions });
  return Object.freeze({ broker, feeModel });
}
