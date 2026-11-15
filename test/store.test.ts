import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import type { FetchResult } from '../src/lib/server/fetch';
import type { Item } from '../src/lib/server/parse';
import { scopes, Store, type Source } from '../src/lib/server/store';

let store: Store;
let feed: Source;
const JAN = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const item = (guid: string, overrides: Partial<Item> = {}): Item => ({
  guid,
  url: `https://example.com/${guid}`,
  title: `Post ${guid}`,
  text: '',
  published: JAN,
  ...overrides,
});
const result = (...items: Item[]): FetchResult => ({ items });
const refresh = () => (feed = store.source(feed.id)!);
const saveItems = (...items: Item[]) => {
  store.save(feed, result(...items), 0, 0);
  refresh();
};
const titles = (scope: Parameters<Store['entries']>[0]) => store.entries(scope).map((entry) => entry.title);

afterEach(() => setSystemTime());

beforeEach(() => {
  store = new Store(':memory:');
  store.addSource('rss', 'https://example.com/feed', 'Example');
  feed = store.sources()[0]!;
});

test("a feed's first fetch is backlog, kept off the home page; later posts are on it", () => {
  saveItems(item('old'));
  expect(titles(scopes.latest)).toEqual([]);
  expect(titles(scopes.feed(feed.id))).toEqual(['Post old']);

  saveItems(item('new', { published: JAN + 1000 }));
  expect(titles(scopes.latest)).toEqual(['Post new']);
});

test("the home page puts what arrived last first, even a post dated earlier; a feed's page keeps the dates' order", () => {
  saveItems(item('backlog'));
  setSystemTime(JAN + 10 * DAY);
  saveItems(item('first', { published: JAN + 9 * DAY }));
  setSystemTime(JAN + 11 * DAY);
  saveItems(item('late', { published: JAN + 2 * DAY }), item('later', { published: JAN + 3 * DAY }));
  expect(titles(scopes.latest)).toEqual(['Post later', 'Post late', 'Post first']);
  expect(titles(scopes.feed(feed.id))).toEqual(['Post first', 'Post later', 'Post late', 'Post backlog']);
});

test('fetching the same item twice changes nothing', () => {
  saveItems(item('a'));
  saveItems(item('a'));
  expect(store.entries(scopes.feed(feed.id))).toHaveLength(1);
});

test('a post whose id changed is updated, not duplicated', () => {
  saveItems(item('a', { title: 'Same', url: 'https://old.example.com/a' }));
  saveItems(item('b', { title: 'Same', url: 'https://new.example.com/a' }));
  const [entry, ...rest] = store.entries(scopes.feed(feed.id));
  expect(rest).toEqual([]);
  expect(entry!.url).toBe('https://new.example.com/a');
});

test('two posts with the same title and date in one fetch are both kept', () => {
  saveItems(item('a', { title: 'Links' }), item('b', { title: 'Links' }));
  expect(store.entries(scopes.feed(feed.id))).toHaveLength(2);
});

test('a post the feed renames, under a new id at the same link, shows its new name', () => {
  saveItems(item('How things win', { url: 'https://example.com/moats' }));
  saveItems(item('Many ways to win', { url: 'https://example.com/moats', title: 'Many ways to win' }));
  expect(titles(scopes.feed(feed.id))).toEqual(['Many ways to win']);
});

test('what the feed now says of a post replaces what it said before: an untitled post shows its text', () => {
  saveItems(item('a', { title: 'Untitled' }));
  saveItems(item('a', { title: '', text: 'A short note' }));
  expect(store.entries(scopes.feed(feed.id))).toMatchObject([{ title: '', text: 'A short note' }]);
});

test('an update posted at the link of what it updates is a post of its own', () => {
  saveItems(item('a', { url: 'https://example.com/uses', title: 'What I use' }));
  saveItems(
    item('a', { url: 'https://example.com/uses', title: 'What I use' }),
    item('a.2', { url: 'https://example.com/uses', title: 'What I use, updated', published: JAN + DAY }),
  );
  expect(titles(scopes.feed(feed.id))).toEqual(['What I use, updated', 'What I use']);
});

test('a new post at a link an older post used is new, even once the older one has left the feed', () => {
  saveItems(item('first', { url: 'https://example.com/', title: 'Episode 1' }));
  saveItems(item('second', { url: 'https://example.com/', title: 'Episode 2', published: JAN + DAY }));
  expect(titles(scopes.feed(feed.id))).toEqual(['Episode 2', 'Episode 1']);
});

test("a page kept from its link that the feed then brings becomes the feed's entry, kept, arriving with it", () => {
  saveItems(item('backlog'));
  setSystemTime(JAN + 10 * DAY);
  store.keepPage('https://example.com/a', 'a - Example');
  saveItems(item('b', { published: JAN + 2 * DAY }));
  setSystemTime(JAN + 20 * DAY);
  saveItems(item('a', { published: JAN + DAY }));
  expect(store.entries(scopes.latest)).toMatchObject([
    { title: 'Post a', feed: 'Example', kept: 1, published_at: JAN + DAY },
    { title: 'Post b' },
  ]);
  expect(titles(scopes.kept)).toEqual(['Post a']);
});

test('a kept page a newly followed feed brings stays where it was, though the rest of that first fetch is backlog', () => {
  saveItems(item('b'));
  store.keepPage('https://elsewhere.example/a', 'Kept');
  const other = store.addSource('rss', 'https://elsewhere.example/feed', 'Elsewhere');
  store.save(store.source(other)!, result(item('a', { url: 'https://elsewhere.example/a' }), item('c')), 0, 0);
  expect(store.entries(scopes.latest)).toMatchObject([{ title: 'Post a', feed: 'Elsewhere', kept: 1 }]);
});

test('impossible dates fall back to now', () => {
  const before = Date.now();
  saveItems(item('a', { published: Date.now() + 10 * 86_400_000 }));
  expect(store.entries(scopes.feed(feed.id))[0]!.published_at).toBeGreaterThanOrEqual(before);
  expect(store.entries(scopes.feed(feed.id))[0]!.published_at).toBeLessThanOrEqual(Date.now());
});

test('a feed where every item has the same date uses the fetch time', () => {
  const before = Date.now();
  saveItems(item('a'), item('b'), item('c'), item('d'));
  for (const entry of store.entries(scopes.feed(feed.id))) expect(entry.published_at).toBeGreaterThanOrEqual(before);
});

test('a next-fetch time with a fraction of a millisecond still saves', () => {
  expect(() => store.save(feed, result(), 0, Date.now() + 1234.5)).not.toThrow();
  expect(Number.isInteger(store.source(feed.id)!.next_at)).toBe(true);
});

test('a failed fetch keeps the old validators', () => {
  store.save(feed, { items: [], etag: 'one', lastModified: 'then' }, 0, 0);
  refresh();
  store.save(feed, { items: [], error: 'HTTP 500' }, 1, 0);
  refresh();
  expect(feed).toMatchObject({ etag: 'one', last_modified: 'then', error: 'HTTP 500', failures: 1 });
});

test('keeping something from the backlog brings it onto the home page, to stay there', () => {
  saveItems(item('a'));
  const id = store.entries(scopes.feed(feed.id))[0]!.id;
  expect(store.keep([id, 999], true)).toMatchObject([{ id, kept: 1 }]);
  expect(titles(scopes.kept)).toEqual(['Post a']);
  expect(store.keep([id], false)).toMatchObject([{ kept: 0 }]);
  expect(titles(scopes.kept)).toEqual([]);
  expect(titles(scopes.latest)).toEqual(['Post a']);
});

test("a feed's muted words keep matching entries off the home page, not off its own", () => {
  saveItems(item('backlog'));
  saveItems(item('a', { title: 'Sponsored: buy this', published: JAN + 1000 }), item('b', { published: JAN + 2000 }));
  expect(store.setMutes(feed.id, [' SPONSORED ', 'sponsored', ''])).toEqual(['sponsored']);
  expect(titles(scopes.latest)).toEqual(['Post b']);
  expect(titles(scopes.feed(feed.id))).toContain('Sponsored: buy this');
});

test('a link kept is stored once: an entry a feed already has is kept instead', () => {
  saveItems(item('a'));
  expect(store.keepPage('https://example.com/a', '')).toMatchObject({ title: 'Post a', kept: 1, feed: 'Example' });
  expect(store.keepPage('https://elsewhere.example/x', 'Elsewhere')).toMatchObject({
    kept: 1,
    feed: 'elsewhere.example',
    site: 'elsewhere.example',
  });
  expect(titles(scopes.kept).toSorted()).toEqual(['Elsewhere', 'Post a']);
  expect(store.sources().map((source) => source.label)).toEqual(['Example']);
});

test('a link kept at the address its page gives finds the entry stored at the link, and the other way round', () => {
  saveItems(item('a', { url: 'https://example.com/a?utm_source=rss' }));
  const viaFeed = store.keepPage('https://example.com/a', 'a', 'https://example.com/a?utm_source=rss');
  expect(viaFeed).toMatchObject({ title: 'Post a', feed: 'Example' });
  const page = store.keepPage('https://youtube.com/watch?v=1', 'Video', 'https://youtube.com/watch?v=1&index=2');
  expect(store.keepPage('https://youtube.com/watch?v=1', 'Video', 'https://youtube.com/watch?v=1&index=3').id).toBe(
    page.id,
  );
  expect(store.entries(scopes.kept)).toHaveLength(2);
});

test('a database from when entries had a state, bookmarked one of them, keeps every entry, what was kept and the backlog', () => {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/lagan-migrate-${process.pid}.sqlite`;
  const old = new Database(path, { create: true });
  old.run(`CREATE TABLE sources (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('rss', 'atproto')), ref TEXT NOT NULL UNIQUE, label TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '', etag TEXT NOT NULL DEFAULT '', last_modified TEXT NOT NULL DEFAULT '', fetched_at INTEGER, next_at INTEGER, failures INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE entries (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, published_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('none', 'unread', 'read', 'bookmarked')), title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '') STRICT;
    CREATE INDEX timeline ON entries(published_at DESC, id DESC) WHERE state <> 'none';
    INSERT INTO sources (id, kind, ref, label) VALUES (1, 'rss', 'https://example.com/feed', 'Example');
    INSERT INTO entries (source_id, guid, url, published_at, state, title) VALUES (1, 'a', 'https://example.com/a', 1, 'bookmarked', 'Kept'), (1, 'b', 'https://example.com/b', 2, 'unread', 'New'), (1, 'c', 'https://example.com/c', 3, 'none', 'Backlog');
    CREATE TABLE mutes (source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, word TEXT NOT NULL, PRIMARY KEY (source_id, word)) STRICT;
    INSERT INTO mutes VALUES (1, 'sponsored');`);
  old.close();
  try {
    const migrated = new Store(path);
    expect(migrated.entries(scopes.kept)).toMatchObject([{ title: 'Kept', kept: 1 }]);
    expect(migrated.entries(scopes.latest).map((entry) => entry.title)).toEqual(['New', 'Kept']);
    expect(migrated.entries(scopes.feed(1))).toHaveLength(3);
    migrated.keepPage('https://elsewhere.example/x', 'Elsewhere'); // a site can be added now
    migrated.removeSource(1); // and removing a feed still reaches its mutes
    expect(
      migrated
        .entries(scopes.kept)
        .map((entry) => entry.title)
        .toSorted(),
    ).toEqual(['Elsewhere', 'Kept']);
    expect(new Store(path).entries(scopes.kept)).toHaveLength(2); // opening it again changes nothing
  } finally {
    for (const suffix of ['', '-wal', '-shm'])
      Bun.file(path + suffix)
        .delete()
        .catch(() => {});
  }
});

test('search finds titles, the backlog too, not body text', () => {
  saveItems(item('a', { title: 'Neovim tricks' }), item('b', { title: 'Other', text: 'neovim in the body' }));
  expect(store.searchEntries('neovim').map((entry) => entry.title)).toEqual(['Neovim tricks']);
});

test('search matches whole words, except the word still being typed', () => {
  saveItems(item('a', { title: 'Trust the process' }), item('b', { title: 'Rust notes' }));
  expect(store.searchEntries('rust').map((entry) => entry.title)).toEqual(['Rust notes']);
  expect(store.searchEntries('ru').map((entry) => entry.title)).toEqual(['Rust notes']);
  expect(store.searchEntries('ru notes')).toEqual([]);
});

test('search puts exact matches before partial ones', () => {
  saveItems(
    item('a', { title: 'Going places', published: JAN + 5000 }),
    item('b', { title: 'Why go', published: JAN }),
  );
  expect(store.searchEntries('go').map((entry) => entry.title)).toEqual(['Why go', 'Going places']);
});

test('an untitled entry is searched by the text it shows', () => {
  saveItems(item('a', { title: '', text: 'A short microblog post' }));
  expect(store.searchEntries('microblog')).toHaveLength(1);
});

test('feeds match by name before address', () => {
  store.addSource('rss', 'https://blog.example.org/feed', 'Zeta');
  store.addSource('rss', 'https://x.example.org/feed', 'My blog');
  expect(store.searchFeeds('blog').map((source) => source.label)).toEqual(['My blog', 'Zeta']);
});

test('copies left by a moved site merge, kept and out of the backlog if any copy was', () => {
  saveItems(
    item('a', { title: 'Same', url: 'https://one.example.com/post' }),
    item('copy', { title: 'Same', url: 'https://two.example.com/post' }),
  );
  store.keep([store.entries(scopes.feed(feed.id)).at(-1)!.id], true);

  expect(store.mergeMoved()).toBe(1);
  expect(store.entries(scopes.feed(feed.id))).toMatchObject([{ kept: 1, url: 'https://two.example.com/post' }]);
  expect(titles(scopes.latest)).toEqual(['Same']);
});

test('copies at different paths are different posts', () => {
  saveItems(
    item('a', { title: 'Links', url: 'https://example.com/one' }),
    item('b', { title: 'Links', url: 'https://example.com/two' }),
  );
  expect(store.mergeMoved()).toBe(0);
  expect(store.entries(scopes.feed(feed.id))).toHaveLength(2);
});

test('pages kept from their links belong to their sites, and so does what is kept from a feed no longer followed', () => {
  saveItems(item('a'));
  const page = store.keepPage('https://www.youtube.com/watch?v=1', 'Logical fallacies - YouTube');
  expect(page).toMatchObject({ feed: 'youtube.com' });
  expect(store.keepPage('https://youtube.com/watch?v=2', 'Two').source_id).toBe(page.source_id);
  const a = store.entries(scopes.feed(feed.id))[0]!;
  store.keep([a.id], true);
  store.removeSource(feed.id);
  expect(store.entry(a.id)).toMatchObject({ feed: 'example.com', kept: 1 });
  expect(store.sources()).toEqual([]); // sites aren't feeds
});

test("a site's cuts tidy its titles, in any case, and never leave one empty", () => {
  const page = store.keepPage('https://youtube.com/watch?v=1', 'Logical fallacies - YouTube');
  store.setCuts(page.source_id, ['- youtube', ' ']);
  expect(store.entry(page.id)!.title).toBe('Logical fallacies');
  store.setCuts(page.source_id, ['Logical fallacies - YouTube']);
  expect(store.entry(page.id)!.title).toBe('Logical fallacies - YouTube');
});

test('a database from when entries had a read state and bookmarked was a column, with all kept pages in one source, moves over', () => {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/lagan-migrate-flags-${process.pid}.sqlite`;
  const old = new Database(path, { create: true });
  old.run(`CREATE TABLE sources (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('rss', 'atproto', 'page')), ref TEXT NOT NULL UNIQUE, label TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '', etag TEXT NOT NULL DEFAULT '', last_modified TEXT NOT NULL DEFAULT '', fetched_at INTEGER, next_at INTEGER, failures INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE entries (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, published_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('none', 'unread', 'read')), bookmarked INTEGER NOT NULL DEFAULT 0 CHECK (bookmarked IN (0, 1)), title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '') STRICT;
    CREATE INDEX by_state ON entries(state, published_at DESC, id DESC);
    INSERT INTO sources (id, kind, ref, label) VALUES (1, 'rss', 'https://example.com/feed', 'Example'), (2, 'page', 'pages', 'Pages');
    INSERT INTO entries (source_id, guid, url, published_at, state, bookmarked, title) VALUES
      (1, 'a', 'https://example.com/a', 1, 'read', 1, 'Kept post'), (1, 'b', 'https://example.com/b', 2, 'none', 0, 'Backlog'),
      (2, 'https://youtube.com/watch?v=1', 'https://youtube.com/watch?v=1', 3, 'read', 1, 'Video');`);
  old.close();
  try {
    const migrated = new Store(path);
    expect(migrated.entries(scopes.kept).map((entry) => [entry.title, entry.site])).toEqual([
      ['Video', 'youtube.com'],
      ['Kept post', null],
    ]);
    expect(migrated.entries(scopes.latest).map((entry) => entry.title)).toEqual(['Video', 'Kept post']);
  } finally {
    for (const suffix of ['', '-wal', '-shm'])
      Bun.file(path + suffix)
        .delete()
        .catch(() => {});
  }
});

test('a database from before arrivals were noted lists what it has as before, and what arrives next first', () => {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/lagan-arrivals-${process.pid}.sqlite`;
  const old = new Database(path, { create: true });
  old.run(`CREATE TABLE sources (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('rss', 'atproto', 'page')), ref TEXT NOT NULL UNIQUE, label TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '', etag TEXT NOT NULL DEFAULT '', last_modified TEXT NOT NULL DEFAULT '', fetched_at INTEGER, next_at INTEGER, failures INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE entries (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, published_at INTEGER NOT NULL, backlog INTEGER NOT NULL DEFAULT 0 CHECK (backlog IN (0, 1)), kept INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1)), title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '') STRICT;
    CREATE INDEX latest ON entries(published_at DESC, id DESC) WHERE backlog = 0;
    INSERT INTO sources (id, kind, ref, label, fetched_at) VALUES (1, 'rss', 'https://example.com/feed', 'Example', 1);
    INSERT INTO entries (source_id, guid, url, published_at, title) VALUES (1, 'a', 'https://example.com/a', ${JAN + 2 * DAY}, 'Newer'), (1, 'b', 'https://example.com/b', ${JAN + DAY}, 'Older');`);
  old.close();
  try {
    const migrated = new Store(path);
    expect(migrated.entries(scopes.latest).map((entry) => entry.title)).toEqual(['Newer', 'Older']);
    migrated.save(migrated.source(1)!, result(item('late', { published: JAN })), 0, 0);
    expect(migrated.entries(scopes.latest).map((entry) => entry.title)).toEqual(['Post late', 'Newer', 'Older']);
  } finally {
    for (const suffix of ['', '-wal', '-shm'])
      Bun.file(path + suffix)
        .delete()
        .catch(() => {});
  }
});

test('a database from when a feed could have one post per link takes an update posted at the link of what it updates', () => {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/lagan-links-${process.pid}.sqlite`;
  new Store(path).addSource('rss', 'https://example.com/feed', 'Example');
  const old = new Database(path);
  old.run(`CREATE UNIQUE INDEX source_url ON entries(source_id, url) WHERE url <> ''`);
  old.close();
  try {
    store = new Store(path);
    feed = store.sources()[0]!;
    saveItems(item('a', { url: 'https://example.com/uses' }));
    saveItems(
      item('a', { url: 'https://example.com/uses' }),
      item('a.2', { url: 'https://example.com/uses', title: 'Updated', published: JAN + DAY }),
    );
    expect(store.entries(scopes.feed(feed.id))).toHaveLength(2);
  } finally {
    for (const suffix of ['', '-wal', '-shm'])
      Bun.file(path + suffix)
        .delete()
        .catch(() => {});
  }
});
