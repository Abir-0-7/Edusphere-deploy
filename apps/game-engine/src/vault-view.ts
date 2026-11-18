import { GAME_DEFINITIONS, GameSession } from './legacy-session';
import { FixedTimestepLoop } from './loop';
import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';
import { TOWER_CARDS } from './games/tower-cards';
import { createServerRewardClient, type GameRewardClient } from './rewards';

const CSS = `
.sv-vault{font:16px/1.5 system-ui,sans-serif;color:#e2e8f0;background:#0f172a;border-radius:16px;padding:clamp(12px,3vw,28px);box-sizing:border-box;width:100%;max-width:1080px;margin:auto}
.sv-vault *{box-sizing:border-box}.sv-vault h2{font-size:clamp(22px,4vw,30px);margin:0 0 12px}.sv-vault p{margin:12px 0}
.sv-vault button{font:inherit;cursor:pointer;min-height:48px;border:1px solid #64748b;border-radius:8px;background:#1e293b;color:#f8fafc;padding:10px 14px;touch-action:manipulation}
.sv-vault button:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}.sv-vault button[aria-pressed=true]{background:#0f766e;border-color:#5eead4}.sv-vault button:disabled{cursor:default;opacity:.65}
.sv-vault .sv-menu{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.sv-vault .sv-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.sv-vault .sv-board{min-height:260px;padding:12px 0;display:grid;gap:8px;align-content:center}
.sv-vault .sv-sort{grid-template-columns:repeat(4,minmax(0,1fr))}.sv-vault .sv-sort button{font-size:clamp(22px,5vw,36px);min-height:92px;padding:8px}
.sv-vault .sv-queens{grid-template-columns:repeat(4,minmax(0,1fr));max-width:420px;margin:auto;width:100%;gap:3px}.sv-vault .sv-queens button{aspect-ratio:1;min-height:52px;font-size:clamp(20px,5vw,32px);padding:4px}.sv-vault .sv-queens button:nth-child(8n+2),.sv-vault .sv-queens button:nth-child(8n+4),.sv-vault .sv-queens button:nth-child(8n+5),.sv-vault .sv-queens button:nth-child(8n+7){background:#475569}.sv-vault .sv-queens button[data-attacked=true]{color:#fda4af;box-shadow:inset 0 0 0 3px #fb7185}
.sv-vault .sv-hanoi{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.sv-vault .sv-hanoi button{min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:8px 4px;gap:5px;min-height:240px}.sv-vault .sv-disk{height:22px;background:#38bdf8;border-radius:6px;display:block;color:#082f49;font-size:14px;font-weight:bold}.sv-vault .sv-peg{font-size:13px;margin-top:12px}
.sv-vault .sv-tower{display:block}.sv-vault .sv-enemy{padding:6px 0;display:flex;gap:10px;align-items:center}.sv-vault progress{width:min(65%,400px);accent-color:#fb7185}.sv-vault .sv-answers{display:flex;gap:12px}.sv-vault .sv-answers button{flex:1;min-height:56px}.sv-vault .sv-prompt{font-size:clamp(18px,4vw,24px);min-height:72px}.sv-vault .sv-feedback{min-height:26px;color:#fde68a}.sv-vault .sv-help{color:#cbd5e1;font-size:14px}.sv-vault :fullscreen{overflow:auto}
@media(min-width:760px){.sv-vault .sv-menu{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function button(text: string, run: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}

/** One accessible DOM view for the standalone engine and the signed-in web app.
 * Native buttons provide pointer, touch, Tab/Enter/Space and screen reader input.
 * Visual updates retain button nodes and keyboard focus, including during ticks.
 */
export function mountGameVault(
  host: HTMLElement,
  options: { rewards?: GameRewardClient } = {},
): { destroy(): void; session: GameSession } {
  const session = new GameSession();
  const loop = new FixedTimestepLoop(60);
  const rewards = options.rewards ?? createServerRewardClient();
  let alive = true,
    generation = 0,
    frame = 0,
    lastTime = 0,
    renderSteps = 0;
  let rewardState: 'idle' | 'pending' | 'done' | 'failed' = 'idle';
  let rewardMessage = '';
  const style = element('style');
  style.textContent = CSS;
  const root = element('section', '', 'sv-vault');
  root.setAttribute('aria-label', 'Learning game vault');
  const title = element('h2', 'Learning games');
  const menu = element('nav', '', 'sv-menu');
  menu.setAttribute('aria-label', 'Choose a game');
  const instructions = element('p');
  const status = element('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const toolbar = element('div', '', 'sv-toolbar');
  const pause = button('Pause', () => {
    session.paused = !session.paused;
    loop.reset();
    render();
  });
  const reset = button('Reset game', () => select(session.gameId));
  const retry = button('Retry reward verification', () => {
    rewardState = 'idle';
    render();
  });
  const fullscreen = button('Full screen', () => {
    const request = root.requestFullscreen?.();
    if (request)
      void request.catch(() => {
        session.message = 'Full screen is unavailable. You can keep playing here.';
        render();
      });
  });
  toolbar.append(pause, reset, fullscreen, retry);
  const board = element('div', '', 'sv-board');
  const feedback = element('p', '', 'sv-feedback');
  feedback.setAttribute('role', 'status');
  const help = element(
    'p',
    'Use Tab then Enter/Space, or tap a control. Pause (P), reset (R). Tower answers: Y for True, N for False.',
    'sv-help',
  );
  root.append(title, menu, instructions, toolbar, status, board, feedback, help);
  host.replaceChildren(style, root);
  const menus = GAME_DEFINITIONS.map((definition) => {
    const control = button(definition.label, () => select(definition.id));
    menu.append(control);
    return control;
  });
  let controls: HTMLButtonElement[] = [];
  let prompt: HTMLParagraphElement | undefined;
  let enemyList: HTMLDivElement | undefined;

  function select(id: GameSession['gameId']): void {
    generation++;
    session.reset(id);
    loop.reset();
    rewardState = 'idle';
    rewardMessage = '';
    controls = [];
    prompt = undefined;
    enemyList = undefined;
    board.replaceChildren();
    const state = session.state;
    board.className = `sv-board ${state instanceof SortingRace ? 'sv-sort' : state instanceof NQueens ? 'sv-queens' : state instanceof TowersOfHanoi ? 'sv-hanoi' : 'sv-tower'}`;
    if (state instanceof FlashcardTowerDefense) {
      prompt = element('p', '', 'sv-prompt');
      enemyList = element('div');
      const answers = element('div', '', 'sv-answers');
      controls = [
        button('True (Y)', () => {
          session.answer(true);
          render();
        }),
        button('False (N)', () => {
          session.answer(false);
          render();
        }),
      ];
      answers.append(...controls);
      board.append(prompt, answers, enemyList);
    } else {
      const count =
        state instanceof SortingRace ? state.items.length : state instanceof NQueens ? state.size ** 2 : 3;
      for (let index = 0; index < count; index++) {
        const control = button('', () => {
          session.choose(index);
          render();
        });
        controls.push(control);
        board.append(control);
      }
    }
    render();
  }

  function verify(): void {
    if (!session.complete || rewardState !== 'idle') return;
    rewardState = 'pending';
    const snapshotGeneration = generation;
    const actions = session.actions.map((action) => ({ ...action }));
    void rewards
      .award(session.gameId, actions)
      .then(({ tokensAwarded }) => {
        if (!alive || snapshotGeneration !== generation) return;
        rewardState = 'done';
        rewardMessage =
          tokensAwarded > 0
            ? `${tokensAwarded} study tokens awarded.`
            : 'Today’s reward was already collected. Keep practising.';
        render();
      })
      .catch((error: unknown) => {
        console.warn(
          'Game reward verification unavailable:',
          error instanceof Error ? error.name : 'UnknownError',
        );
        if (!alive || snapshotGeneration !== generation) return;
        rewardState = 'failed';
        rewardMessage = 'Game complete. Reward verification failed; retry when connected.';
        render();
      });
  }

  function render(): void {
    const state = session.state;
    menus.forEach((control, index) =>
      control.setAttribute('aria-pressed', String(GAME_DEFINITIONS[index]?.id === session.gameId)),
    );
    instructions.textContent = GAME_DEFINITIONS.find(
      (definition) => definition.id === session.gameId,
    )!.instructions;
    pause.textContent = session.paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(session.paused));
    pause.disabled = session.complete || session.lost;
    const disabled = session.paused || session.complete || session.lost;
    controls.forEach((control) => {
      control.disabled = disabled;
    });
    if (state instanceof SortingRace) {
      state.items.forEach((item, index) => {
        controls[index]!.textContent = String(item.value);
        controls[index]!.setAttribute('aria-label', `Tile ${index + 1}: ${item.value}`);
        controls[index]!.setAttribute('aria-pressed', String(index === session.selected));
      });
    } else if (state instanceof NQueens) {
      controls.forEach((control, index) => {
        const row = Math.floor(index / state.size),
          column = index % state.size,
          occupied = state.columns[row] === column;
        control.textContent = occupied ? '♛' : '·';
        control.setAttribute(
          'aria-label',
          `Row ${row + 1}, column ${column + 1}${occupied ? ', queen' : ''}`,
        );
        control.setAttribute('aria-pressed', String(occupied));
        control.dataset.attacked = String(occupied && state.attacked(row, column));
      });
    } else if (state instanceof TowersOfHanoi) {
      controls.forEach((control, index) => {
        control.replaceChildren();
        const tower = state.towers[index]!;
        [...tower].reverse().forEach((disk) => {
          const block = element('span', String(disk), 'sv-disk');
          block.style.width = `${30 + disk * 15}%`;
          control.append(block);
        });
        control.append(element('span', `Tower ${index + 1}`, 'sv-peg'));
        control.setAttribute(
          'aria-label',
          `Tower ${index + 1}, disks from bottom: ${tower.join(', ') || 'empty'}`,
        );
        control.setAttribute('aria-pressed', String(index === session.selected));
      });
    } else {
      const enemy = state.enemies[0];
      prompt!.textContent = enemy
        ? TOWER_CARDS[(enemy.id - 1) % TOWER_CARDS.length]!.prompt
        : 'The next enemy arrives in a moment…';
      controls.forEach((control) => {
        control.disabled ||= !enemy;
      });
      enemyList!.replaceChildren(
        ...state.enemies.map((item) => {
          const line = element('div', '', 'sv-enemy'),
            meter = element('progress');
          meter.max = 1;
          meter.value = Math.min(1, item.progress);
          meter.setAttribute('aria-label', `Enemy ${item.id} approach`);
          line.append(element('span', `Enemy ${item.id}`), meter);
          return line;
        }),
      );
    }
    verify();
    retry.hidden = rewardState !== 'failed';
    status.textContent = session.complete
      ? `Game complete. ${rewardState === 'pending' ? 'Verifying reward…' : rewardMessage}`
      : session.lost
        ? 'Game over. Reset to try again.'
        : `${session.paused ? 'Paused. ' : ''}Score: ${state.score}${state instanceof FlashcardTowerDefense ? ` · Lives: ${state.lives} · Target: 5 enemies` : ` · Moves: ${session.actions.length}`}`;
    feedback.textContent = session.message;
  }
  function onKey(event: KeyboardEvent): void {
    if (!root.contains(document.activeElement)) return;
    if (event.key.toLowerCase() === 'p' && !session.complete && !session.lost) {
      event.preventDefault();
      pause.click();
    }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      reset.click();
    }
    if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      session.answer(true);
      render();
    }
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      session.answer(false);
      render();
    }
  }
  function onVisibility(): void {
    if (document.hidden && !session.complete && !session.lost) {
      session.paused = true;
      loop.reset();
      render();
    }
  }
  function animate(time: number): void {
    if (!alive) return;
    const delta = lastTime ? (time - lastTime) / 1000 : 0;
    lastTime = time;
    loop.advance(delta, () => {
      if (session.tick()) renderSteps++;
    });
    if (renderSteps >= 6 || session.complete || session.lost) {
      renderSteps = 0;
      render();
    }
    frame = requestAnimationFrame(animate);
  }
  root.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  select('SortingRace');
  frame = requestAnimationFrame(animate);
  return {
    session,
    destroy() {
      alive = false;
      generation++;
      cancelAnimationFrame(frame);
      root.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      host.replaceChildren();
    },
  };
}
