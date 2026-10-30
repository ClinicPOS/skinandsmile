import assert from 'node:assert/strict';
import {testModuleLoader} from './load-test-module.mjs';
let states = [], cursor = 0;
const react = {useRef(value) {const slot = cursor++; return states[slot] ??= {current: value};},
  useState(value) {const slot = cursor++; if (!(slot in states)) states[slot] = value; return [states[slot], next => states[slot] = next];}};
const {AsyncActionButton} = testModuleLoader({}, {react})('components/async-action-button.tsx');
function render(props) {cursor = 0; return AsyncActionButton(props);}
let calls = 0, resolve;
const props = {children: 'Save', busyLabel: 'Saving...', onClick: () => {calls++; return new Promise(r => resolve = r);}};
let tree = render(props), button = tree.props.children[0];
const first = button.props.onClick({}); const spam = button.props.onClick({});
assert.equal(calls, 1, 'synchronous lock must prevent repeated clicks before rendering');
tree = render(props); button = tree.props.children[0];
assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true); assert.equal(button.props.children, 'Saving...');
resolve(); await Promise.all([first, spam]);
tree = render(props); assert.equal(tree.props.children[0].props.disabled, false);
const failing = {...props, onClick: async () => {throw new Error('TEST retry');}};
await render(failing).props.children[0].props.onClick({});
tree = render(failing); assert.equal(tree.props.children[0].props.disabled, false); assert.equal(tree.props.children[1].props.role, 'alert');
assert.equal(tree.props.children[1].props.children, 'TEST retry');
await render({...props, disabled: true}).props.children[0].props.onClick({}); assert.equal(calls, 1);
console.log('PASS: actual action button blocks same-tick double clicks, displays loading/disabled state, clears after success/failure, reports failure, and respects existing disabled state.');

// Execute actual print helper with controlled image events and fallback timers.
const timers = [], listeners = {}; let prints = 0, alerts = 0;
const image = {complete: false, addEventListener(event, cb) {listeners[event] = cb;}};
const popup = {document: {open() {}, write() {}, close() {}, images: [image]}, focus() {}, print() {prints++;}};
const branding = testModuleLoader({window: {open: () => popup}, alert: () => alerts++,
  setTimeout(cb, delay) {const timer = {cb, delay, active: true}; timers.push(timer); return timer;}, clearTimeout(timer) {timer.active = false;},
})('lib/receipt-branding.ts');
const printPromise = branding.printHtmlWhenImagesReady('TEST HTML');
listeners.load();
timers.find(timer => timer.delay === 100).cb();
timers.find(timer => timer.delay === 1500).cb(); // even if fallback was already queued
await printPromise; assert.equal(prints, 1, 'image and fallback must not each print');
const blocked = testModuleLoader({window: {open: () => null}, alert: () => alerts++})('lib/receipt-branding.ts');
await blocked.printHtmlWhenImagesReady('TEST'); assert.equal(alerts, 1);
console.log('PASS: images/fallback print exactly once; preparation can be awaited; blocked popups finish and report the problem.');
