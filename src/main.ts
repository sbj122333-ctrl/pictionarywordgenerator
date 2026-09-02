// Entry point. Everything else is in ui/, state/ and engine/, in that dependency
// direction — see docs/TECHNICAL_SPEC.md §1.
import { App } from './ui/app';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) void new App(root).start();
