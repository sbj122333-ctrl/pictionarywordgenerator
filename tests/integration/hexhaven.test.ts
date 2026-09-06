/**
 * Hexhaven — the third game, quarantined in `public/hexhaven/` (CLAUDE.md,
 * "The Hexhaven boundary"). It shares no code with `src/`, so nothing here can
 * import it: the page's own `<script>` blocks are lifted out of the HTML and run
 * in a `node:vm` context instead. That is deliberate. The alternative is a build
 * step for a file whose whole point is that it has none, and the alternative to
 * *that* is a game with no tests at all.
 *
 * Only the pure engine and the session layer are evaluated. The UI block wants a
 * document and is left alone; the vendored PeerJS bundle is only parsed, to
 * catch a truncated paste.
 *
 * Four defects found reviewing the Hexhaven branch are pinned below. Each one
 * survives a full setup phase first, because every one of them needs a real
 * board underneath it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* ---------------- the slice of the engine's shapes these tests touch ---------------- */

interface Player {
  name: string;
  resources: Record<string, number>;
  dev: Record<string, number>;
  devLocked: Record<string, number>;
}
interface Building {
  type: 'settlement' | 'city';
  owner: number;
}
interface Board {
  hexOrder: string[];
  hexes: Record<string, { vertices: string[] }>;
  harbors: unknown[];
  robber: string;
}
interface Setup {
  order: number[];
  idx: number;
  need: 'settlement' | 'road';
  lastVertex: string | null;
}
interface GameState {
  phase: string;
  turn: number;
  dice: [number, number] | null;
  hasRolled: boolean;
  playedDevThisTurn: boolean;
  players: Player[];
  board: Board;
  buildings: Record<string, Building>;
  roads: Record<string, number>;
  bank: Record<string, number>;
  deck: string[];
  setup: Setup | null;
  awaiting: { type: string; player: number; reason?: string } | null;
}
interface ActionResult {
  ok: boolean;
  error?: string;
}
interface View {
  robber: string;
  board?: Board;
}
interface Engine {
  createGame(seats: { name: string }[], options: Record<string, unknown>, seed?: number): GameState;
  apply(st: GameState, pi: number, action: Record<string, unknown>): ActionResult;
  viewFor(st: GameState, pi: number): View;
  actorsAwaited(st: GameState): number[];
  legalSettlementSpots(st: GameState, pi: number, setup: boolean): string[];
  legalRoadSpots(st: GameState, pi: number, restrictToVertex?: string | null): string[];
}

/* ---------------- and of the session layer's ---------------- */

type Message = Record<string, unknown>;
interface Channel {
  send(m: Message): void;
  onData(f: (m: Message) => void): void;
  onClose(f: () => void): void;
  close(): void;
}
interface ChatLine {
  from?: string;
  text: string;
  sys?: boolean;
}
interface HostLike {
  seats: { name: string; token: string }[];
  chat: ChatLine[];
  attach(c: Channel): void;
  broadcast(): void;
}
interface ClientLike {
  view: { board: Board } | null;
  receive(m: Message): void;
}
interface Net {
  Host: new (name: string, opts: { localOnly: boolean }) => HostLike;
  Client: new () => ClientLike;
}

/* ---------------- load ---------------- */

const PAGE = fileURLToPath(new URL('../../public/hexhaven/index.html', import.meta.url));

let E: Engine;
let N: Net;
let blocks: string[];

beforeAll(() => {
  const html = readFileSync(PAGE, 'utf8');
  blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');

  const engineSrc = blocks.find((b) => b.includes('HEXHAVEN — game engine'));
  const netSrc = blocks.find((b) => b.includes('HEXHAVEN — session layer'));
  if (!engineSrc || !netSrc) throw new Error('the engine or session <script> block has moved');

  // Both blocks close over `global`, which they resolve to `window` in a browser.
  const sandbox: Record<string, unknown> = { console, JSON, Math, Date, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(engineSrc, ctx);
  vm.runInContext(netSrc, ctx);

  E = sandbox.HexEngine as Engine;
  N = sandbox.HexNet as Net;
});

const seats = (n: number): { name: string }[] =>
  Array.from({ length: n }, (_, i) => ({ name: 'P' + (i + 1) }));

/** Plays the whole snake-order placement round, always taking the first legal spot. */
function playSetup(st: GameState): void {
  for (let guard = 0; st.phase === 'setup' && guard < 400; guard++) {
    const pi = E.actorsAwaited(st)[0] as number;
    const setup = st.setup as Setup;
    const move =
      setup.need === 'settlement'
        ? { type: 'setupSettlement', vertex: E.legalSettlementSpots(st, pi, true)[0] }
        : { type: 'setupRoad', edge: E.legalRoadSpots(st, pi, setup.lastVertex)[0] };
    const r = E.apply(st, pi, move);
    if (!r.ok) throw new Error(`${move.type}: ${r.error}`);
  }
  expect(st.phase).toBe('roll');
}

describe('hexhaven / the page itself', () => {
  it('every script block parses, vendored bundle included', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const [i, src] of blocks.entries()) {
      expect(() => new vm.Script(src, { filename: `hexhaven-block-${i}.js` })).not.toThrow();
    }
  });

  it('adds no outbound request outside public/hexhaven/', () => {
    // NFR-03 holds absolutely for src/. This game is the one exception and it
    // stays inside its own directory — no import, no fetch, no shared bundle.
    const html = readFileSync(PAGE, 'utf8');
    expect(html).not.toMatch(/\bfrom\s+['"]\.\.\/\.\.\/src\//);
  });
});

describe('hexhaven / board', () => {
  it.each([
    [3, 19, 9],
    [4, 19, 9],
    [5, 30, 11],
    [6, 30, 11],
  ])('deals a %i-player board of %i hexes and %i harbours', (n, hexes, harbours) => {
    const st = E.createGame(seats(n), { vpTarget: 10 }, 1234 + n);
    expect(st.board.hexOrder).toHaveLength(hexes);
    expect(st.board.harbors).toHaveLength(harbours);
    playSetup(st);
    // Two settlements and two roads each, and the snake order gives everyone both.
    expect(Object.keys(st.buildings)).toHaveLength(n * 2);
    expect(Object.keys(st.roads)).toHaveLength(n * 2);
  });
});

describe('hexhaven / a refused action leaves nothing behind', () => {
  /**
   * `apply` has no rollback — it only withholds the version bump — so every
   * action has to finish validating before it mutates anything. Two did not.
   */

  it('keeps a Year of Plenty the bank cannot fill', () => {
    const st = E.createGame(seats(3), {}, 7);
    playSetup(st);
    st.phase = 'main';
    st.turn = 0;
    st.hasRolled = true;
    st.dice = [3, 4];
    const p = st.players[0] as Player;
    p.dev.plenty = 1;
    p.devLocked.plenty = 0;
    st.bank.ore = 1;

    const refused = E.apply(st, 0, { type: 'playDev', card: 'plenty', picks: ['ore', 'ore'] });
    expect(refused.ok).toBe(false);
    // The card used to be spent, and the turn's one dev-card play used up, before
    // the bank was ever consulted.
    expect(p.dev.plenty).toBe(1);
    expect(st.playedDevThisTurn).toBe(false);

    const played = E.apply(st, 0, { type: 'playDev', card: 'plenty', picks: ['ore', 'wool'] });
    expect(played.ok).toBe(true);
    expect(p.dev.plenty).toBe(0);
  });

  it('leaves the robber where it was when the victim is not on that hex', () => {
    const st = E.createGame(seats(3), {}, 9);
    playSetup(st);
    const before = st.board.robber;
    st.phase = 'robber';
    st.awaiting = { type: 'robber', player: 0, reason: 'seven' };
    for (const p of st.players) p.resources.wool = 3;

    // a hex two other players are built on, so the engine asks who to rob
    const contested = st.board.hexOrder.find((h) => {
      if (h === before) return false;
      const owners = new Set(
        (st.board.hexes[h]?.vertices ?? [])
          .map((v) => st.buildings[v]?.owner)
          .filter((o): o is number => o !== undefined && o !== 0),
      );
      return owners.size >= 2;
    });
    expect(contested).toBeDefined();

    const refused = E.apply(st, 0, { type: 'moveRobber', hex: contested, victim: 0 });
    expect(refused.ok).toBe(false);
    expect(st.board.robber).toBe(before);
  });
});

describe('hexhaven / the wire', () => {
  it('tracks the robber on a board the client has already cached', () => {
    // The board is 20-40 KB of graph and is sent once per game, then cached.
    // `robber` is the only field on it that moves, so it has to ride separately
    // or it freezes on the desert for the whole game — on every screen at once,
    // the host's included, since the host renders through a Client too.
    const st = E.createGame(seats(3), {}, 11);
    playSetup(st);

    const client = new N.Client();
    const first = JSON.parse(JSON.stringify(E.viewFor(st, 1))) as Record<string, unknown>;
    expect(first.robber).toBe(st.board.robber);
    client.receive({ t: 'state', view: first });

    const moved = st.board.hexOrder.find((h) => h !== st.board.robber) as string;
    st.board.robber = moved;
    const next = JSON.parse(JSON.stringify(E.viewFor(st, 1))) as Record<string, unknown>;
    delete next.board; // what broadcast() does once a seat has the board
    client.receive({ t: 'state', view: next });

    expect(client.view?.board.robber).toBe(moved);
  });

  it('keeps a seat pinned to its player when the lobby shrinks', () => {
    // Seats were addressed by the index a channel was handed on arrival, and
    // both leaving and being kicked splice the array. One departure and every
    // seat below it spoke with the wrong voice.
    const host = new N.Host('Host', { localOnly: false });
    host.broadcast = (): void => {};

    const channels = ['A', 'B', 'C'].map((name) => {
      const sent: Message[] = [];
      let onData: (m: Message) => void = () => {};
      let onClose: () => void = () => {};
      const chan: Channel & { sent: Message[]; fire(m: Message): void; drop(): void } = {
        sent,
        send: (m) => void sent.push(m),
        onData: (f) => { onData = f; },
        onClose: (f) => { onClose = f; },
        close: () => {},
        fire: (m) => onData(m),
        drop: () => onClose(),
      };
      host.attach(chan);
      chan.fire({ t: 'hello', name, token: 'tok-' + name });
      return chan;
    });
    expect(host.seats.map((s) => s.name)).toEqual(['A', 'B', 'C']);

    channels[0]?.drop();
    expect(host.seats.map((s) => s.name)).toEqual(['B', 'C']);

    // C sat at index 2 and now sits at 1; its channel must still speak as C.
    channels[2]?.fire({ t: 'chat', text: 'still me' });
    expect(host.chat[host.chat.length - 1]?.from).toBe('C');

    // and B leaving must take B out, not the player who slid into its slot
    channels[1]?.drop();
    expect(host.seats.map((s) => s.name)).toEqual(['C']);
  });
});
