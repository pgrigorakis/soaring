// Full-viewport white start screen. The world renders behind it from the first frame. The fade begins only
// after a click, near terrain, and the first world frame's GPU work plus one more browser frame.
// The terrain wait is capped after the click; the GPU/frame guarantee is never bypassed.

const FADE_MS = 1800;
const TERRAIN_WAIT_MS = 8000;

function gpuIdle(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) {
    gl.finish();
    return Promise.resolve();
  }
  gl.flush();
  return new Promise((resolve) => {
    const poll = (): void => {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        window.setTimeout(poll, 4);
        return;
      }
      gl.deleteSync(sync);
      resolve();
    };
    poll();
  });
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export interface StartScreen {
  /** Call after each world draw. Readiness includes ground, water and near trees. */
  worldFrameDrawn(gl: WebGL2RenderingContext, nearReady: boolean): void;
  readonly holding: boolean;
  readonly fading: boolean;
  /** Resolves when the fade into the world begins. */
  readonly revealed: Promise<void>;
}

export function createStartScreen(app: HTMLElement): StartScreen {
  const screen = document.createElement('button');
  screen.type = 'button';
  screen.id = 'start-screen';
  screen.className = 'start-screen';
  screen.innerHTML = '<span class="start-title">Soaring</span><span class="start-prompt">Click anywhere to start</span>';
  app.append(screen);

  let holding = true;
  let fading = false;
  let timer: number | undefined;
  let nearDrawn!: () => void;
  const nearReady = new Promise<void>((resolve) => { nearDrawn = resolve; });
  let clicked!: () => void;
  const clickedPromise = new Promise<void>((resolve) => { clicked = resolve; });
  screen.addEventListener('click', () => {
    screen.classList.add('started');
    // Cap only the terrain wait, not the GPU fence or browser-frame barrier.
    timer = window.setTimeout(nearDrawn, TERRAIN_WAIT_MS);
    clicked();
  }, { once: true });

  let drawn!: () => void;
  const worldReady = new Promise<void>((resolve) => { drawn = resolve; });

  const revealed = Promise.all([clickedPromise, worldReady, nearReady]).then(() => {
    window.clearTimeout(timer);
    holding = false;
    fading = true;
    screen.classList.add('fading');
    window.setTimeout(() => { fading = false; screen.remove(); }, FADE_MS + 100);
  });
  let firstSubmitted = false;
  let nearSubmitted = false;

  return {
    worldFrameDrawn(gl, ready) {
      if (!firstSubmitted) {
        firstSubmitted = true;
        void gpuIdle(gl).then(nextFrame).then(drawn);
      }
      if (ready && !nearSubmitted) {
        nearSubmitted = true;
        // The completed near terrain must also reach the GPU before the white screen leaves.
        void gpuIdle(gl).then(nextFrame).then(nearDrawn);
      }
    },
    get holding() { return holding; },
    get fading() { return fading; },
    revealed,
  };
}
