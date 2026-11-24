// Composition root: the only module assembling application and presentation.
import { fixture } from "./application/fixture.js";
import { flowSnapshot } from "./application/flow.js";
import { mountRouter } from "./ui/router.js";
import { mountSettings } from "./ui/settings.js";
import { mountFlow } from "./ui/flow.js";

mountRouter();
mountSettings(fixture);
mountFlow({evaluate:fixture,snapshot:flowSnapshot});
