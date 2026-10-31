import { Game } from './core/Game.js';
import { isWebGLAvailable } from './core/Device.js';
import { installErrorReporting } from './debug/Diagnostics.js';

installErrorReporting();

/**
 * Entry point: boots the game, drives the loading screen, shows control
 * hints and handles fatal errors. No menus by design (Phase 1).
 */

const $ = (id) => document.getElementById(id);

function setProgress(text, fraction) {
  $('loading-text').textContent = text;
  $('loading-bar-fill').style.width = `${Math.round(fraction * 100)}%`;
}

function showError(title, message, detail) {
  const el = $('error');
  el.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  el.append(h, p);
  if (detail) {
    const code = document.createElement('code');
    code.textContent = String(detail);
    el.append(code);
  }
  el.classList.remove('hidden');
  $('loading').classList.add('hidden');
}

function setupHints(game) {
  const hint = $('controls-hint');
  const prompt = $('start-prompt');

  const desktopHint =
    '<kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>Click</kbd> attack · <kbd>F</kbd> heavy · ' +
    '<kbd>RMB</kbd> block · <kbd>C</kbd> roll · <kbd>E</kbd> interact · <kbd>I</kbd> journal';
  const touchHint = 'Left thumb: move (push far to run) · Drag right side: look · Buttons: fight, roll, use';

  const useTouchHint = () => {
    hint.textContent = touchHint;
    hint.classList.add('touch');
  };

  if (game.quality.mobile && game.touch) useTouchHint();
  else hint.innerHTML = desktopHint;
  if (!game.quality.mobile) prompt.classList.remove('hidden');

  game.input.on('activate', () => prompt.classList.add('hidden'));
  game.input.on('lockchange', (locked) => {
    if (!locked && !game.quality.mobile) {
      prompt.querySelector('.start-title').textContent = 'Click to resume';
      prompt.classList.remove('hidden');
    }
  });

  if (game.touch) {
    game.touch.onFirstTouch = () => {
      prompt.classList.add('hidden');
      useTouchHint();
    };
  }
  setTimeout(() => hint.classList.add('faded'), 14000);
}

async function main() {
  if (!isWebGLAvailable()) {
    showError(
      'WebGL 2 not available',
      'This game needs a browser and device with WebGL 2 enabled (any recent Chrome, Edge, Firefox or Safari).',
    );
    return;
  }

  const game = new Game($('app'));
  try {
    await game.init(setProgress);
  } catch (err) {
    console.error(err);
    showError('The realm failed to load', 'Something went wrong while starting the game.', err?.stack || err);
    return;
  }

  game.renderer.onContextLost = () =>
    showError('Graphics context lost', 'The GPU reset or ran out of memory. Reload the page to continue.');

  setupHints(game);
  game.start();

  const loading = $('loading');
  loading.classList.add('fade-out');
  setTimeout(() => loading.classList.add('hidden'), 700);

  // Handy for debugging in the browser console.
  window.__game = game;
}

main();
