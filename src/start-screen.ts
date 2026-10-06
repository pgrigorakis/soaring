// Full-viewport white start screen. The world renders behind it from the first frame. The fade begins only
// after a click AND after the first world frame's GPU work has finished and one more browser frame has passed.

const FADE_MS = 1800;

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
  /** Call right after the first world frame has been submitted to the GPU. */
  firstFrameDrawn(gl: WebGL2RenderingContext): void;
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

  let clicked!: () => void;
  const clickedPromise = new Promise<void>((resolve) => { clicked = resolve; });
  screen.addEventListener('click', () => {
    screen.classList.add('started');
    clicked();
  }, { once: true });

  let drawn!: () => void;
  const worldReady = new Promise<void>((resolve) => { drawn = resolve; });

  const revealed = Promise.all([clickedPromise, worldReady]).then(() => {
    screen.classList.add('fading');
    window.setTimeout(() => screen.remove(), FADE_MS + 100);
  });

  return {
    firstFrameDrawn(gl) {
      void gpuIdle(gl).then(nextFrame).then(drawn);
    },
    revealed,
  };
}
