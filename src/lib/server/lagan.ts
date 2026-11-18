// The one database and fetcher the running app uses.
import { join } from 'node:path';
import { Fetcher } from './fetch';
import { Store } from './store';

// Follow answers once the feed is fetched, so its page has its posts.
export type Lagan = { store: Store; wake: () => void; follow: (id: number) => Promise<void> };

// The app's database, wherever it is started from.
export const DATABASE = join(import.meta.dir, '../../../data/lagan.sqlite');

const globals = globalThis as typeof globalThis & { lagan?: Lagan };

// Started once per process: `bun --hot` runs the modules again on every
// change, so the running copy is kept on the global object.
export function start(): Lagan {
  if (globals.lagan) return globals.lagan;
  const store = new Store(DATABASE);
  const removed = store.mergeMoved();
  if (removed) console.log(`Merged ${removed} copies of moved posts`);
  const fetcher = new Fetcher(store);
  fetcher.startAll();
  return (globals.lagan = { store, wake: () => fetcher.check(), follow: (id) => fetcher.start(id) });
}
